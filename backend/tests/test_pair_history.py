"""Backend API tests for the newly added /api/pair-history endpoint
and the new from_item_id/to_item_id fields on /api/arbitrage steps.

Contract under test (per review request):
  - GET /api/pair-history?league=...&c1_id=291&c2_id=287&limit=48
      returns {league, c1_item_id, c2_item_id, points[],
               high, low, avg, latest, change_pct}
  - Each point: {epoch, rate, inverse_rate, volume, c1_stock, c2_stock}
      sorted ascending by epoch
  - high/low/avg/latest match the points;
      change_pct = (latest/first - 1) * 100
  - limit < 1 or limit > 720 -> 422 (Pydantic validation)
  - Bad pair ids -> upstream 404 -> backend returns 200 with empty points
  - /api/arbitrage steps now expose from_item_id and to_item_id (int|null)
"""
import pytest

LEAGUE = "Runes of Aldur"

# Known item ids (per agent context)
DIVINE = 291
CHAOS = 287
EXALTED = 290


# ---------------- /api/pair-history ----------------
class TestPairHistory:
    @pytest.fixture(scope="class")
    def history_response(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/pair-history",
            params={
                "league": LEAGUE,
                "c1_id": DIVINE,
                "c2_id": CHAOS,
                "limit": 48,
            },
            timeout=60,
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_response_shape(self, history_response):
        body = history_response
        required = {"league", "c1_item_id", "c2_item_id", "points",
                    "high", "low", "avg", "latest", "change_pct"}
        missing = required - set(body.keys())
        assert not missing, f"Missing keys in response: {missing}"
        assert body["league"] == LEAGUE
        assert body["c1_item_id"] == DIVINE
        assert body["c2_item_id"] == CHAOS
        assert isinstance(body["points"], list)

    def test_points_schema(self, history_response):
        pts = history_response["points"]
        if not pts:
            pytest.skip("Upstream returned no history for divine/chaos pair")
        required = {"epoch", "rate", "inverse_rate", "volume",
                    "c1_stock", "c2_stock"}
        for p in pts[:5]:
            missing = required - set(p.keys())
            assert not missing, f"Point missing keys: {missing}: keys={list(p.keys())}"
            assert isinstance(p["epoch"], int)
            assert p["rate"] > 0
            assert p["inverse_rate"] > 0
            # rate * inverse_rate should be ~ 1.0
            assert abs(p["rate"] * p["inverse_rate"] - 1.0) < 1e-6, (
                f"rate*inverse_rate != 1: {p['rate']} * {p['inverse_rate']}"
            )
            assert p["volume"] >= 0
            assert p["c1_stock"] >= 0
            assert p["c2_stock"] >= 0

    def test_points_sorted_ascending_by_epoch(self, history_response):
        pts = history_response["points"]
        if len(pts) < 2:
            pytest.skip("Not enough history points to verify sort order")
        epochs = [p["epoch"] for p in pts]
        assert epochs == sorted(epochs), (
            f"Points not sorted ascending by epoch. First 5: {epochs[:5]}, "
            f"last 5: {epochs[-5:]}"
        )

    def test_limit_respected(self, history_response):
        pts = history_response["points"]
        # Server requested 48 hourly points (max); upstream may return fewer
        assert len(pts) <= 48, f"Got {len(pts)} points, expected <= 48"

    def test_aggregates_match_points(self, history_response):
        pts = history_response["points"]
        if not pts:
            # Empty case: aggregates should be zero
            for k in ("high", "low", "avg", "latest", "change_pct"):
                assert history_response[k] == 0
            return
        rates = [p["rate"] for p in pts]
        assert abs(history_response["high"] - max(rates)) < 1e-6
        assert abs(history_response["low"] - min(rates)) < 1e-6
        assert abs(history_response["avg"] - sum(rates) / len(rates)) < 1e-6
        assert abs(history_response["latest"] - rates[-1]) < 1e-6
        expected_change = ((rates[-1] / rates[0]) - 1.0) * 100 if rates[0] > 0 else 0.0
        assert abs(history_response["change_pct"] - expected_change) < 1e-6, (
            f"change_pct mismatch: got {history_response['change_pct']}, "
            f"expected {expected_change}"
        )

    # --- Limit validation ---
    def test_limit_below_one_returns_422(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/pair-history",
            params={"league": LEAGUE, "c1_id": DIVINE, "c2_id": CHAOS, "limit": 0},
            timeout=30,
        )
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"

    def test_limit_negative_returns_422(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/pair-history",
            params={"league": LEAGUE, "c1_id": DIVINE, "c2_id": CHAOS, "limit": -5},
            timeout=30,
        )
        assert r.status_code == 422

    def test_limit_above_max_returns_422(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/pair-history",
            params={"league": LEAGUE, "c1_id": DIVINE, "c2_id": CHAOS, "limit": 721},
            timeout=30,
        )
        assert r.status_code == 422

    def test_limit_max_720_ok(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/pair-history",
            params={"league": LEAGUE, "c1_id": DIVINE, "c2_id": CHAOS, "limit": 720},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body.get("points"), list)

    # --- Required param validation ---
    def test_missing_required_params_returns_422(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/pair-history", timeout=15)
        assert r.status_code == 422

    # --- Graceful upstream 404 -> empty points ---
    def test_bad_pair_ids_returns_200_empty(self, api_client, base_url):
        """poe2scout returns 404 for unknown pair; backend must absorb -> 200 empty."""
        r = api_client.get(
            f"{base_url}/api/pair-history",
            params={
                "league": LEAGUE,
                "c1_id": 99999991,
                "c2_id": 99999992,
                "limit": 24,
            },
            timeout=60,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert body["points"] == [], f"Expected empty points, got {body['points']}"
        for k in ("high", "low", "avg", "latest", "change_pct"):
            assert body[k] == 0, f"Expected {k}=0 for empty history, got {body[k]}"

    # --- Different currency pair (exalted <-> divine) sanity ---
    def test_exalted_divine_history(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/pair-history",
            params={
                "league": LEAGUE,
                "c1_id": EXALTED,
                "c2_id": DIVINE,
                "limit": 24,
            },
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["c1_item_id"] == EXALTED
        assert body["c2_item_id"] == DIVINE
        if body["points"]:
            # Sanity: exalted -> divine rate should be < 1 (divine more valuable)
            assert body["latest"] > 0


# ---------------- /api/arbitrage step.from_item_id / to_item_id ----------------
class TestArbitrageStepItemIds:
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

    def test_steps_expose_item_ids(self, arb_response):
        opps = arb_response.get("multi_hop", [])
        if not opps:
            pytest.skip("No multi_hop opportunities to validate item_id fields")
        for o in opps[:5]:
            for s in o["steps"]:
                assert "from_item_id" in s, f"Step missing 'from_item_id': {list(s.keys())}"
                assert "to_item_id" in s, f"Step missing 'to_item_id': {list(s.keys())}"
                # When present, must be integers (Optional[int])
                if s["from_item_id"] is not None:
                    assert isinstance(s["from_item_id"], int), (
                        f"from_item_id should be int, got {type(s['from_item_id'])}"
                    )
                if s["to_item_id"] is not None:
                    assert isinstance(s["to_item_id"], int), (
                        f"to_item_id should be int, got {type(s['to_item_id'])}"
                    )

    def test_majority_steps_have_item_ids(self, arb_response):
        """poe2scout returns ItemId for the major currencies — assert most steps
        actually carry the integer ids so the UI can link to history charts."""
        opps = arb_response.get("multi_hop", [])
        if not opps:
            pytest.skip("No multi_hop opportunities")
        total_steps = 0
        with_ids = 0
        for o in opps[:10]:
            for s in o["steps"]:
                total_steps += 1
                if s.get("from_item_id") is not None and s.get("to_item_id") is not None:
                    with_ids += 1
        assert total_steps > 0
        ratio = with_ids / total_steps
        assert ratio >= 0.8, (
            f"Only {with_ids}/{total_steps} steps have item ids "
            f"({ratio:.0%}); expected >=80%"
        )
