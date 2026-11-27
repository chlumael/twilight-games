// 재화 계산: 지금 재화로 몇 번 뽑을 수 있는지, 뽑으면 어떤 재화가 얼마나 줄어드는지 (정리 2026-11-27: ledger.ts에서 나눔)
import type { SpendStep } from "./games";

/** Pulls affordable with the given currency, following the spend order. */
export function availablePulls(currency: Record<string, number>, spend: SpendStep[]): number {
  return spend.reduce((sum, s) => {
    const pool = (currency[s.key] ?? 0) + (s.topUp ? (currency[s.topUp.key] ?? 0) * s.topUp.rate : 0);
    return sum + Math.floor(pool / s.cost) * s.pulls;
  }, 0);
}

/** How many of the affordable pulls depend on currency `key` (e.g. 창세의 결정). */
export function pullsFrom(currency: Record<string, number>, spend: SpendStep[], key: string): number {
  return availablePulls(currency, spend) - availablePulls({ ...currency, [key]: 0 }, spend);
}

/**
 * Deduct currency for `n` pulls in spend order. Multi-pull items (10-pull permits)
 * are only used while at least that many pulls remain.
 */
export function deduct(
  currency: Record<string, number>,
  spend: SpendStep[],
  n: number,
): { currency: Record<string, number>; shortfall: number } {
  const next = { ...currency };
  let remaining = n;
  for (const s of spend) {
    while (remaining >= s.pulls) {
      const have = next[s.key] ?? 0;
      if (have < s.cost && s.topUp) {
        // Convert only what is missing for this pull, if the top-up source covers it.
        const need = Math.ceil((s.cost - have) / s.topUp.rate);
        if ((next[s.topUp.key] ?? 0) < need) break;
        next[s.topUp.key] = (next[s.topUp.key] ?? 0) - need;
        next[s.key] = have + need * s.topUp.rate;
      }
      if ((next[s.key] ?? 0) < s.cost) break;
      next[s.key] = (next[s.key] ?? 0) - s.cost;
      remaining -= s.pulls;
    }
  }
  return { currency: next, shortfall: remaining };
}

/** What `n` pulls would consume, per currency key, in spend order. */
export function spendPreview(
  currency: Record<string, number>,
  spend: SpendStep[],
  n: number,
): { items: { key: string; amount: number }[]; shortfall: number } {
  const r = deduct(currency, spend, n);
  const keys = spend.flatMap((s) => (s.topUp ? [s.key, s.topUp.key] : [s.key]));
  const items = keys
    .map((key) => ({ key, amount: (currency[key] ?? 0) - (r.currency[key] ?? 0) }))
    .filter((x) => x.amount > 0);
  return { items, shortfall: r.shortfall };
}
