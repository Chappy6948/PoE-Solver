# PRD — Profit Oracle: PoE 2 Arbitrage Mobile App

## Goal
Help Path of Exile 2 players spot profitable currency-exchange arbitrage cycles using live data from poe2scout.com (focus on the rune exchange).

## User Flow
1. App opens to dashboard with current league preselected (Runes of Aldur).
2. User picks their starting currency ("YOU HAVE") and enters BUDGET.
3. User picks number of hops (2 / 3 / 4) and preset (Conservative / Balanced / Aggressive — drives liquidity & profit caps).
4. Tap **Hunt Arbitrage** → app fetches live snapshot from poe2scout and scans cycles.
5. Results list shows each cycle with profit %, absolute profit, currency chain, and bottleneck stock.
6. Tap a card to see the full step-by-step trade plan with exact quantities at each hop.

## Data Source
- `https://poe2scout.com/api/poe2/Leagues` — list leagues
- `https://poe2scout.com/api/poe2/Leagues/{league}/SnapshotPairs` — all current exchange pairs with RelativePrice + liquidity (HighestStock, Volume)
- Backend caches responses for 3–5 minutes to respect rate limits

## Arbitrage Algorithm
- Build a directed graph: each pair (A,B) gives two directional edges with rate `RelativePrice(A) / RelativePrice(B)`.
- DFS from base currency back to itself, up to `max_hops` hops.
- Apply liquidity bottleneck (cap qty by min `HighestStock` along the path).
- Filter by min/max profit% (per preset) and min volume/stock per pair.
- Rune-touching cycles are prioritised in sorting.
- Direct (1-pair round-trip) arbitrage = 0 by construction; only multi-pair cycles produce arbitrage.

## Architecture
- **Backend**: FastAPI on port 8001, all routes under `/api`. In-memory async cache.
- **Frontend**: Expo Router (file-based), single screen, React Native components only, dark gaming theme (`/app/frontend/src/theme.ts`).
- **Storage**: MongoDB (unused so far; ready for "saved cycles" feature).

## Key Files
- `/app/backend/server.py` — endpoints `/api/leagues`, `/api/currencies`, `/api/pairs`, `/api/arbitrage`
- `/app/frontend/app/index.tsx` — main UI
- `/app/frontend/src/api.ts` — typed API client
- `/app/frontend/src/theme.ts` — dark gaming design tokens

## Defaults
- League: current (`Runes of Aldur`)
- Base currency: `exalted`
- Budget: 100
- Hops: 3
- Preset: Balanced (`min_volume=5000`, `min_stock=300`, `max_profit_pct=50`)

## Smart Business Enhancement (Next)
- Add a "Save cycle" feature backed by MongoDB so players can star their favourite arbitrage paths and get a quick "Re-scan favourites" button — drives daily engagement and could power a premium "alerts when this cycle exceeds X%" subscription.

## Pair History Charts (v1.1)
- New endpoint `GET /api/pair-history?league=&c1_id=&c2_id=&limit=` proxies poe2scout's `/Currencies/Pairs/{c1}/{c2}/History` and returns normalized hourly points: `{epoch, rate, inverse_rate, volume, c1_stock, c2_stock}` plus `{high, low, avg, latest, change_pct}`.
- `TradeStep` now exposes `from_item_id` / `to_item_id` so the UI can request history for any leg of an arbitrage cycle.
- New component `/app/frontend/src/components/PairHistoryChart.tsx` renders an `react-native-svg` line + area chart with 24h / 7d / 30d range chips and stat cells (Latest, Change, High, Low).
- Each step in the opportunity detail modal has a "History" pill that opens the chart for that pair.
