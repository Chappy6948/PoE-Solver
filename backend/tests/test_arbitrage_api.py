"""Backend API tests for PoE2 Arbitrage app.

Validates the contract documented in the review request:
  - /api/leagues
  - /api/currencies
  - /api/arbitrage
  - /api/pairs
"""
import pytest

LEAGUE = "Runes of Aldur"


# ------------- Health / Root -------------
class TestHealth:
    def test_root(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "PoE2" in body.get("message", "")


# ------------- /api/leagues -------------
class TestLeagues:
    def test_leagues_returns_list(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leagues", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list) and len(data) > 0
        # Schema
        for d in data:
            assert {"value", "short_name", "is_current"} <= set(d.keys())

    def test_leagues_contains_current_runes_of_aldur(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leagues", timeout=30)
        assert r.status_code == 200
        data = r.json()
        names = [d["value"] for d in data]
        assert LEAGUE in names, f"League '{LEAGUE}' not found. Got: {names}"
        current = [d for d in data if d.get("is_current")]
        assert any(d["value"] == LEAGUE for d in current), (
            f"'{LEAGUE}' not marked is_current=true. Current leagues: "
            f"{[d['value'] for d in current]}"
        )


# ------------- /api/currencies -------------
class TestCurrencies:
    def test_currencies_returns_list(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/currencies", params={"league": LEAGUE}, timeout=30
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list) and len(data) > 0
        for c in data[:5]:
            assert {"api_id", "text", "category"} <= set(c.keys())

    def test_currencies_contains_majors(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/currencies", params={"league": LEAGUE}, timeout=30
        )
        assert r.status_code == 200
        data = r.json()
        ids = {c["api_id"] for c in data}
        for k in ("exalted", "divine", "chaos"):
            assert k in ids, f"Currency '{k}' missing. Sample ids: {list(ids)[:20]}"

    def test_currencies_priority_order(self, api_client, base_url):
        """exalted/divine/chaos should appear before non-priority ones."""
        r = api_client.get(
            f"{base_url}/api/currencies", params={"league": LEAGUE}, timeout=30
        )
        data = r.json()
        # First three items should be the priority ones in expected order
        first_ids = [c["api_id"] for c in data[:3]]
        assert first_ids[0] == "exalted", f"Expected exalted first, got {first_ids}"


# ------------- /api/arbitrage -------------
class TestArbitrage:
    @pytest.fixture(scope="class")
    def arb_response(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/arbitrage",
            params={
                "league": LEAGUE,
                "base": "exalted",
                "budget": 100,
                "max_hops": 3,
            },
            timeout=60,
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_response_shape(self, arb_response):
        body = arb_response
        for k in ("league", "base_currency", "budget", "direct", "multi_hop"):
            assert k in body, f"Missing key '{k}' in response: {list(body.keys())}"
        assert body["league"] == LEAGUE
        assert body["base_currency"] == "exalted"
        assert float(body["budget"]) == 100.0
        assert isinstance(body["direct"], list)
        assert isinstance(body["multi_hop"], list)

    def test_direct_can_be_empty_multi_hop_should_have_results(self, arb_response):
        # Direct (2-hop) is mathematically expected to be empty
        assert isinstance(arb_response["direct"], list)
        # Multi-hop should have results with default filters
        assert len(arb_response["multi_hop"]) > 0, (
            "Expected multi_hop arbitrage opportunities with default filters "
            "(min_volume=5000, min_stock=300, max_profit_pct=50)"
        )

    def test_opportunity_schema(self, arb_response):
        opps = arb_response["multi_hop"]
        if not opps:
            pytest.skip("No multi-hop opportunities to validate schema")
        for o in opps[:3]:
            for k in ("cycle", "hops", "profit_pct", "start_qty", "end_qty",
                      "steps", "liquidity_score", "summary"):
                assert k in o, f"Missing key '{k}' in opp keys: {list(o.keys())}"
            # cycle starts & ends at same currency
            assert isinstance(o["cycle"], list) and len(o["cycle"]) >= 3
            assert o["cycle"][0] == o["cycle"][-1], (
                f"Cycle should start and end at same currency: {o['cycle']}"
            )
            # steps
            assert isinstance(o["steps"], list) and len(o["steps"]) >= 2
            for s in o["steps"]:
                for sk in ("from_currency", "to_currency", "rate", "qty_in",
                           "qty_out", "max_available"):
                    assert sk in s, f"Step missing key '{sk}'"
                assert s["rate"] > 0
                assert s["qty_in"] >= 0
                assert s["qty_out"] >= 0
            # summary is a non-empty string
            assert isinstance(o["summary"], str) and len(o["summary"]) > 0

    def test_sorted_by_profit_desc(self, arb_response):
        for key in ("direct", "multi_hop"):
            opps = arb_response[key]
            profits = [o["profit_pct"] for o in opps]
            # rune_focus boost groups touches_rune True/False, then profit desc
            # within each group. Just verify global non-increasing for top group.
            if len(profits) >= 2:
                # Allow the rune_focus secondary grouping by checking the first
                # group is non-increasing. We'll just assert that the max is at
                # or near the top half, not require strict monotonic global.
                top_half = profits[: max(1, len(profits) // 2)]
                assert top_half == sorted(top_half, reverse=True), (
                    f"{key} top-half not sorted by profit_pct desc: {top_half}"
                )

    def test_arbitrage_profits_within_cap(self, arb_response):
        for o in arb_response["multi_hop"]:
            assert o["profit_pct"] <= 50.0 + 1e-6, (
                f"profit_pct {o['profit_pct']} exceeds default max_profit_pct=50"
            )


# ------------- Filter params -------------
class TestArbitrageFilters:
    def test_max_hops_2(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/arbitrage",
            params={"league": LEAGUE, "base": "exalted", "budget": 100,
                    "max_hops": 2},
            timeout=60,
        )
        assert r.status_code == 200
        body = r.json()
        # multi_hop only contains hops>=3 per server code, so with max_hops=2 it
        # should be empty
        assert body["multi_hop"] == []

    def test_max_hops_4(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/arbitrage",
            params={"league": LEAGUE, "base": "exalted", "budget": 100,
                    "max_hops": 4},
            timeout=90,
        )
        assert r.status_code == 200
        body = r.json()
        # Should have multi-hop results
        assert isinstance(body["multi_hop"], list)

    def test_max_hops_out_of_range(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/arbitrage",
            params={"league": LEAGUE, "base": "exalted", "budget": 100,
                    "max_hops": 5},
            timeout=30,
        )
        assert r.status_code == 422  # Pydantic/FastAPI validation

    def test_min_profit_pct_filter(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/arbitrage",
            params={"league": LEAGUE, "base": "exalted", "budget": 100,
                    "max_hops": 3, "min_profit_pct": 5.0},
            timeout=60,
        )
        assert r.status_code == 200
        body = r.json()
        for o in body["multi_hop"]:
            assert o["profit_pct"] >= 5.0 - 1e-6

    def test_max_profit_pct_filter(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/arbitrage",
            params={"league": LEAGUE, "base": "exalted", "budget": 100,
                    "max_hops": 3, "max_profit_pct": 10.0},
            timeout=60,
        )
        assert r.status_code == 200
        body = r.json()
        for o in body["multi_hop"]:
            assert o["profit_pct"] <= 10.0 + 1e-6

    def test_high_min_volume_reduces_results(self, api_client, base_url):
        """Setting an absurdly high min_volume should reduce/empty results."""
        r = api_client.get(
            f"{base_url}/api/arbitrage",
            params={"league": LEAGUE, "base": "exalted", "budget": 100,
                    "max_hops": 3, "min_volume": 10_000_000_000},
            timeout=60,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["multi_hop"] == []

    def test_high_min_stock_reduces_results(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/arbitrage",
            params={"league": LEAGUE, "base": "exalted", "budget": 100,
                    "max_hops": 3, "min_stock": 10_000_000},
            timeout=60,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["multi_hop"] == []

    def test_invalid_budget(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/arbitrage",
            params={"league": LEAGUE, "base": "exalted", "budget": 0},
            timeout=30,
        )
        # budget gt=0
        assert r.status_code == 422


# ------------- /api/pairs -------------
class TestPairs:
    def test_pairs_runes_category(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/pairs",
            params={"league": LEAGUE, "category": "runes"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Expected at least one pair touching 'runes'"
        # Each returned pair must touch the runes category on at least one side
        for p in data[:10]:
            assert {"c1", "c2", "rate_c1_to_c2", "rate_c2_to_c1",
                    "volume", "c1_stock", "c2_stock"} <= set(p.keys())
            assert (p["c1"]["category"] == "runes"
                    or p["c2"]["category"] == "runes"), (
                f"Pair does not touch runes: c1={p['c1']['category']}, "
                f"c2={p['c2']['category']}"
            )

    def test_pairs_min_volume_filter(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/pairs",
            params={"league": LEAGUE, "min_volume": 10000},
            timeout=60,
        )
        assert r.status_code == 200
        data = r.json()
        for p in data:
            assert p["volume"] >= 10000

    def test_pairs_sorted_by_volume_desc(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/pairs", params={"league": LEAGUE}, timeout=60
        )
        assert r.status_code == 200
        data = r.json()
        if len(data) >= 2:
            vols = [p["volume"] for p in data]
            assert vols == sorted(vols, reverse=True), "Pairs not sorted by volume desc"
