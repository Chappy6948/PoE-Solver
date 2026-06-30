// Lightweight API client for the PoE2 arbitrage backend.
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type League = {
  value: string;
  short_name: string;
  is_current: boolean;
};

export type Currency = {
  api_id: string;
  text: string;
  category: string;
  icon_url?: string | null;
};

export type TradeStep = {
  from_currency: string;
  to_currency: string;
  from_icon?: string | null;
  to_icon?: string | null;
  from_item_id?: number | null;
  to_item_id?: number | null;
  rate: number;
  qty_in: number;
  qty_out: number;
  max_available: number;
};

export type Arbitrage = {
  cycle: string[];
  hops: number;
  profit_pct: number;
  start_qty: number;
  end_qty: number;
  steps: TradeStep[];
  liquidity_score: number;
  summary: string;
};

export type ArbitrageResponse = {
  league: string;
  base_currency: string;
  budget: number;
  direct: Arbitrage[];
  multi_hop: Arbitrage[];
};

export type HistoryPoint = {
  epoch: number;
  rate: number;
  inverse_rate: number;
  volume: number;
  c1_stock: number;
  c2_stock: number;
};

export type HistoryResponse = {
  league: string;
  c1_item_id: number;
  c2_item_id: number;
  points: HistoryPoint[];
  high: number;
  low: number;
  avg: number;
  latest: number;
  change_pct: number;
};

async function getJSON<T>(path: string): Promise<T> {
  const url = `${BASE}${path}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

export const api = {
  leagues: () => getJSON<League[]>("/api/leagues"),
  currencies: (league: string) =>
    getJSON<Currency[]>(`/api/currencies?league=${encodeURIComponent(league)}`),
  arbitrage: (params: {
    league: string;
    base: string;
    budget: number;
    max_hops: number;
    min_profit_pct?: number;
    max_profit_pct?: number;
    min_volume?: number;
    min_stock?: number;
  }) => {
    const q = new URLSearchParams({
      league: params.league,
      base: params.base,
      budget: String(params.budget),
      max_hops: String(params.max_hops),
      min_profit_pct: String(params.min_profit_pct ?? 0.5),
      max_profit_pct: String(params.max_profit_pct ?? 50),
      min_volume: String(params.min_volume ?? 5000),
      min_stock: String(params.min_stock ?? 300),
    });
    return getJSON<ArbitrageResponse>(`/api/arbitrage?${q.toString()}`);
  },
  history: (params: {
    league: string;
    c1_id: number;
    c2_id: number;
    limit?: number;
  }) => {
    const q = new URLSearchParams({
      league: params.league,
      c1_id: String(params.c1_id),
      c2_id: String(params.c2_id),
      limit: String(params.limit ?? 168),
    });
    return getJSON<HistoryResponse>(`/api/pair-history?${q.toString()}`);
  },
};
