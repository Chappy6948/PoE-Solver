from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import time
import httpx
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional, Dict, Tuple
from decimal import Decimal


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

POE2_API = "https://poe2scout.com/api"
USER_AGENT = "PoE2-Arbitrage-Mobile/1.0 (contact: app@example.com)"

# Simple in-memory cache (TTL-based) to respect upstream rate limits
_cache: Dict[str, Tuple[float, object]] = {}
_locks: Dict[str, asyncio.Lock] = {}


async def cached_fetch(url: str, ttl: int = 300) -> object:
    now = time.time()
    cached = _cache.get(url)
    if cached and (now - cached[0]) < ttl:
        return cached[1]
    lock = _locks.setdefault(url, asyncio.Lock())
    async with lock:
        cached = _cache.get(url)
        if cached and (time.time() - cached[0]) < ttl:
            return cached[1]
        async with httpx.AsyncClient(timeout=20.0, headers={"User-Agent": USER_AGENT}) as hc:
            r = await hc.get(url)
            r.raise_for_status()
            data = r.json()
        _cache[url] = (time.time(), data)
        return data


# ---------------- Models ----------------
class LeagueOut(BaseModel):
    value: str
    short_name: str
    is_current: bool


class CurrencyOut(BaseModel):
    api_id: str
    text: str
    category: str
    icon_url: Optional[str] = None


class PairOut(BaseModel):
    c1: CurrencyOut
    c2: CurrencyOut
    # 1 c1 -> rate_c1_to_c2 units of c2
    rate_c1_to_c2: float
    rate_c2_to_c1: float
    volume: float
    c1_stock: int
    c2_stock: int


class TradeStep(BaseModel):
    from_currency: str
    to_currency: str
    from_icon: Optional[str] = None
    to_icon: Optional[str] = None
    rate: float  # how many to_currency per 1 from_currency
    qty_in: float
    qty_out: float
    max_available: float  # liquidity (HighestStock of the receiving side)


class ArbitrageOut(BaseModel):
    cycle: List[str]
    hops: int
    profit_pct: float
    start_qty: float
    end_qty: float
    steps: List[TradeStep]
    liquidity_score: float  # min stock along the path
    summary: str


# ---------------- Helpers ----------------
def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


# Categories on poe2scout that aren't tradable currencies (skip for arbitrage logic)
TRADABLE_CATEGORIES = {
    "currency", "runes", "essences", "fragments", "delirium", "breach",
    "ritual", "expedition", "vaal", "ultimatum", "incursion", "abyss",
    "uncutgems", "verisium", "vaultkeys", "idol", "lineagesupportgems",
}


# ---------------- Endpoints ----------------
@api_router.get("/")
async def root():
    return {"message": "PoE2 Arbitrage API", "source": "poe2scout.com"}


@api_router.get("/leagues", response_model=List[LeagueOut])
async def get_leagues():
    data = await cached_fetch(f"{POE2_API}/poe2/Leagues", ttl=3600)
    return [
        LeagueOut(
            value=d["Value"],
            short_name=d["ShortName"],
            is_current=bool(d.get("IsCurrent")),
        )
        for d in data
    ]


def _normalize_pair(raw: dict) -> Optional[PairOut]:
    c1 = raw["CurrencyOne"]
    c2 = raw["CurrencyTwo"]
    d1 = raw["CurrencyOneData"]
    d2 = raw["CurrencyTwoData"]
    # poe2scout SnapshotPairs RelativePrice is each currency's value in the
    # league's BASE currency (Exalted Orb for Runes of Aldur). To convert
    # between the two currencies in this pair:
    #   1 C1 -> (C1.RelativePrice / C2.RelativePrice) C2
    p1 = _f(d1.get("RelativePrice"))
    p2 = _f(d2.get("RelativePrice"))
    if p1 <= 0 or p2 <= 0:
        return None
    rate1 = p1 / p2  # 1 C1 -> rate1 of C2
    rate2 = p2 / p1  # 1 C2 -> rate2 of C1
    return PairOut(
        c1=CurrencyOut(
            api_id=c1["ApiId"], text=c1["Text"],
            category=c1.get("CategoryApiId", ""),
            icon_url=c1.get("IconUrl"),
        ),
        c2=CurrencyOut(
            api_id=c2["ApiId"], text=c2["Text"],
            category=c2.get("CategoryApiId", ""),
            icon_url=c2.get("IconUrl"),
        ),
        rate_c1_to_c2=rate1,
        rate_c2_to_c1=rate2,
        volume=_f(raw.get("Volume")),
        c1_stock=int(d1.get("HighestStock") or 0),
        c2_stock=int(d2.get("HighestStock") or 0),
    )


@api_router.get("/pairs")
async def get_pairs(
    league: str = Query(..., description="League name, e.g. 'Runes of Aldur'"),
    category: Optional[str] = Query(None, description="Filter to a category, e.g. 'runes'"),
    min_volume: float = Query(0.0),
):
    encoded = league.replace(" ", "%20")
    raw = await cached_fetch(f"{POE2_API}/poe2/Leagues/{encoded}/SnapshotPairs", ttl=180)
    out: List[PairOut] = []
    for r in raw:
        p = _normalize_pair(r)
        if not p:
            continue
        if category:
            if p.c1.category != category and p.c2.category != category:
                continue
        if p.volume < min_volume:
            continue
        out.append(p)
    out.sort(key=lambda p: p.volume, reverse=True)
    return out


def _find_arbitrage(
    pairs: List[PairOut],
    base_currency_api_id: str,
    budget: float,
    max_hops: int = 4,
    min_profit_pct: float = 0.5,
    min_liquidity: float = 1.0,
    rune_only: bool = False,
) -> List[ArbitrageOut]:
    """Find arbitrage cycles starting and ending at base_currency_api_id.

    We use DFS up to max_hops. Each edge (A -> B) has rate (B per A) and
    a max_qty (how much of B is available on the highest stock order).
    """
    # Build adjacency: from_api_id -> list of (to_api_id, rate, max_b_qty, currency_meta)
    adj: Dict[str, List[Tuple[str, float, float, CurrencyOut]]] = {}
    name_to_meta: Dict[str, CurrencyOut] = {}

    for p in pairs:
        name_to_meta[p.c1.api_id] = p.c1
        name_to_meta[p.c2.api_id] = p.c2

        # Filter: if rune_only, at least one side must be a rune. We still
        # need currency edges (chaos/exalted/divine) to convert in/out.
        # Actually we just allow all pairs and ranking handles category bias.
        # Edge C1 -> C2 (sell C1, receive C2): rate = c1.RelativePrice (C2 per 1 C1)
        adj.setdefault(p.c1.api_id, []).append(
            (p.c2.api_id, p.rate_c1_to_c2, float(p.c2_stock), p.c2)
        )
        # Edge C2 -> C1 (sell C2, receive C1)
        adj.setdefault(p.c2.api_id, []).append(
            (p.c1.api_id, p.rate_c2_to_c1, float(p.c1_stock), p.c1)
        )

    if base_currency_api_id not in adj:
        return []

    base_meta = name_to_meta[base_currency_api_id]
    results: List[ArbitrageOut] = []
    seen_paths: set = set()

    def dfs(curr: str, path: List[Tuple[str, float, float, CurrencyOut]],
            qty: float, visited: set):
        if len(path) >= max_hops:
            return
        for (nxt, rate, max_qty, meta) in adj.get(curr, []):
            if nxt in visited and nxt != base_currency_api_id:
                continue
            if rate <= 0:
                continue
            new_qty = qty * rate
            # constrained by liquidity (max_qty is units of nxt available)
            # path is recorded; quantities recalculated later with bottleneck
            new_path = path + [(nxt, rate, max_qty, meta)]
            if nxt == base_currency_api_id and len(new_path) >= 2:
                profit_pct = (new_qty / budget - 1.0) * 100
                if profit_pct >= min_profit_pct:
                    key = "->".join([base_currency_api_id] + [s[0] for s in new_path])
                    if key not in seen_paths:
                        seen_paths.add(key)
                        # Build steps with bottleneck-adjusted quantities
                        steps_meta = new_path
                        # First, ideal quantities if budget flows through
                        ideal_qtys = [budget]
                        for (_, rate_i, _, _) in steps_meta:
                            ideal_qtys.append(ideal_qtys[-1] * rate_i)
                        # Now apply liquidity: each step's output is capped by max_qty
                        scale = 1.0
                        for i, (_, _, mq, _) in enumerate(steps_meta):
                            out_i = ideal_qtys[i + 1] * scale
                            if mq > 0 and out_i > mq:
                                scale *= mq / out_i
                        adj_qtys = [budget * scale]
                        for (_, rate_i, _, _) in steps_meta:
                            adj_qtys.append(adj_qtys[-1] * rate_i)
                        liq = min((mq for (_, _, mq, _) in steps_meta if mq > 0), default=0)
                        steps: List[TradeStep] = []
                        prev_meta = base_meta
                        for i, (nxt_id, rate_i, mq, meta_i) in enumerate(steps_meta):
                            steps.append(TradeStep(
                                from_currency=prev_meta.text,
                                to_currency=meta_i.text,
                                from_icon=prev_meta.icon_url,
                                to_icon=meta_i.icon_url,
                                rate=rate_i,
                                qty_in=round(adj_qtys[i], 4),
                                qty_out=round(adj_qtys[i + 1], 4),
                                max_available=mq,
                            ))
                            prev_meta = meta_i
                        cycle_names = [base_meta.text] + [s.to_currency for s in steps]
                        profit_pct_adj = (adj_qtys[-1] / adj_qtys[0] - 1.0) * 100 if adj_qtys[0] > 0 else 0
                        summary = (
                            f"Start with {round(adj_qtys[0], 2)} {base_meta.text}, "
                            f"end with {round(adj_qtys[-1], 2)} {base_meta.text} "
                            f"after {len(steps)} trade(s). Profit ≈ "
                            f"{round(adj_qtys[-1] - adj_qtys[0], 2)} {base_meta.text}."
                        )
                        results.append(ArbitrageOut(
                            cycle=cycle_names,
                            hops=len(steps),
                            profit_pct=round(profit_pct_adj, 3),
                            start_qty=round(adj_qtys[0], 4),
                            end_qty=round(adj_qtys[-1], 4),
                            steps=steps,
                            liquidity_score=liq,
                            summary=summary,
                        ))
            elif nxt != base_currency_api_id:
                visited.add(nxt)
                dfs(nxt, new_path, new_qty, visited)
                visited.remove(nxt)

    visited = {base_currency_api_id}
    dfs(base_currency_api_id, [], budget, visited)

    # Sort & dedupe (by cycle membership rotation)
    def canonical(c: List[str]) -> str:
        # cycle starts and ends at base; ignore final element
        body = c[:-1]
        # rotations
        return "|".join(sorted([",".join(body[i:] + body[:i]) for i in range(len(body))]))

    best_by_cycle: Dict[str, ArbitrageOut] = {}
    for r in results:
        k = canonical(r.cycle)
        if k not in best_by_cycle or r.profit_pct > best_by_cycle[k].profit_pct:
            best_by_cycle[k] = r

    final = sorted(best_by_cycle.values(), key=lambda x: x.profit_pct, reverse=True)
    return final[:50]


@api_router.get("/arbitrage")
async def get_arbitrage(
    league: str = Query(...),
    base: str = Query("exalted", description="Base currency api_id"),
    budget: float = Query(100.0, gt=0),
    max_hops: int = Query(3, ge=2, le=4),
    min_profit_pct: float = Query(0.5),
    max_profit_pct: float = Query(50.0, description="Cap to filter stale-data outliers"),
    min_volume: float = Query(5000.0, description="Minimum pair volume (Exalted)"),
    min_stock: int = Query(300, description="Minimum HighestStock on each side"),
    rune_focus: bool = Query(True),
):
    encoded = league.replace(" ", "%20")
    raw = await cached_fetch(f"{POE2_API}/poe2/Leagues/{encoded}/SnapshotPairs", ttl=180)
    pairs: List[PairOut] = []
    for r in raw:
        p = _normalize_pair(r)
        if not p:
            continue
        # Require both volume and stock on both sides for trustworthy rates
        if p.volume < min_volume:
            continue
        if p.c1_stock < min_stock or p.c2_stock < min_stock:
            continue
        pairs.append(p)

    direct = _find_arbitrage(
        pairs, base, budget, max_hops=2, min_profit_pct=min_profit_pct,
    )
    multi = _find_arbitrage(
        pairs, base, budget, max_hops=max_hops, min_profit_pct=min_profit_pct,
    )
    multi_only = [m for m in multi if m.hops >= 3]

    # Drop unrealistic outliers (data quality artifacts)
    direct = [d for d in direct if d.profit_pct <= max_profit_pct]
    multi_only = [m for m in multi_only if m.profit_pct <= max_profit_pct]

    # Rune scoring: boost cycles that touch a rune
    def touches_rune(cyc: ArbitrageOut) -> bool:
        return any(("rune" in s.to_currency.lower() or "aldur" in s.to_currency.lower())
                   for s in cyc.steps)

    if rune_focus:
        direct.sort(key=lambda x: (touches_rune(x), x.profit_pct), reverse=True)
        multi_only.sort(key=lambda x: (touches_rune(x), x.profit_pct), reverse=True)

    return {
        "league": league,
        "base_currency": base,
        "budget": budget,
        "direct": direct[:25],
        "multi_hop": multi_only[:25],
    }


# Currency list for the UI dropdown
@api_router.get("/currencies")
async def list_currencies(league: str = Query(...)):
    encoded = league.replace(" ", "%20")
    raw = await cached_fetch(f"{POE2_API}/poe2/Leagues/{encoded}/SnapshotPairs", ttl=180)
    seen: Dict[str, CurrencyOut] = {}
    for r in raw:
        for k in ("CurrencyOne", "CurrencyTwo"):
            c = r[k]
            if c["ApiId"] not in seen:
                seen[c["ApiId"]] = CurrencyOut(
                    api_id=c["ApiId"], text=c["Text"],
                    category=c.get("CategoryApiId", ""),
                    icon_url=c.get("IconUrl"),
                )
    items = list(seen.values())
    # Keep popular base currencies on top
    priority = ["exalted", "divine", "chaos", "annulment", "vaal", "gcp"]
    items.sort(key=lambda c: (priority.index(c.api_id) if c.api_id in priority else 999, c.text))
    return items


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
