// Daily caps, the browser twin of consume_quota() / refund_quota() in schema.sql.
// Pure functions over a small state object so the rules are unit-tested; the fake
// data layer keeps the state in localStorage.

export type QuotaKind = "preview" | "export";
export type QuotaState = { date: string; preview: number; export: number };

export function emptyQuota(date: string): QuotaState {
  return { date, preview: 0, export: 0 };
}

/** Roll the counters over when the UTC day changes. */
export function forDate(state: QuotaState | null, date: string): QuotaState {
  return state && state.date === date ? state : emptyQuota(date);
}

/** Take one unit. Returns the new state, or null when the cap is reached. */
export function consume(state: QuotaState, kind: QuotaKind, cap: number): QuotaState | null {
  if (cap <= 0 || state[kind] >= cap) return null;
  return { ...state, [kind]: state[kind] + 1 };
}

/** Give one unit back (our fault: the render failed), never below zero, only for the same day. */
export function refund(state: QuotaState, kind: QuotaKind, date: string): QuotaState {
  if (state.date !== date) return state;
  return { ...state, [kind]: Math.max(0, state[kind] - 1) };
}

export function remaining(state: QuotaState, kind: QuotaKind, cap: number): number {
  return Math.max(0, cap - state[kind]);
}
