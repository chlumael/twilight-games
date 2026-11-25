import { GAMES, GAME_IDS, findGroup, type SpendStep } from "./games";
import type { Baseline, GameId, GameRecord, Pull, Records } from "./types";

const UNDO_LIMIT = 50;

export function emptyGameRecord(): GameRecord {
  return { pulls: [], currency: {}, currencyUpdatedAt: null, baseline: {}, currentBanner: {} };
}

export function emptyRecords(): Records {
  const games = {} as Records["games"];
  for (const id of GAME_IDS) games[id] = emptyGameRecord();
  return { schemaVersion: 1, games, undo: [] };
}

/** Fill in anything missing from an older or hand-edited file. */
export function normalizeRecords(raw: unknown): Records {
  const base = emptyRecords();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<Records>;
  for (const id of GAME_IDS) {
    base.games[id] = { ...emptyGameRecord(), ...(r.games?.[id] ?? {}) };
  }
  base.undo = Array.isArray(r.undo) ? r.undo : [];
  return base;
}

export function emptyBaseline(): Baseline {
  return { pity: 0, guaranteed: false, banner: "", bannerPulls: 0, bannerFeaturedGot: false };
}

function byTime(a: Pull, b: Pull): number {
  return a.time === b.time ? a.indexInSession - b.indexInSession : a.time < b.time ? -1 : 1;
}

export interface CounterStatus {
  label: string;
  at: number;
  remaining: number;
  done: boolean;
}

export interface GroupStatus {
  groupId: string;
  name: string;
  pity: number;
  hardPity: number | null;
  softFrom: number | null;
  /** fifty-fifty: next top is guaranteed featured. fate-point: point is 1. null = rule n/a. */
  guaranteed: boolean | null;
  /** A top pull with unknown featured status makes `guaranteed` uncertain. */
  guaranteeUncertain: boolean;
  banner: string;
  bannerPulls: number;
  counters: CounterStatus[];
  lastTop: Pull | null;
}

export function groupStatus(rec: GameRecord, game: GameId, groupId: string): GroupStatus {
  const group = findGroup(game, groupId);
  const banner = rec.currentBanner[groupId] ?? "";
  const base = rec.baseline[groupId] ?? emptyBaseline();
  const baseOnThisBanner = base.banner === banner;

  let pulls = rec.pulls.filter((p) => p.group === groupId).sort(byTime);
  if (!group.carryOver) pulls = pulls.filter((p) => p.banner === banner);

  let pity = group.carryOver || baseOnThisBanner ? base.pity : 0;
  let guaranteed = base.guaranteed;
  let uncertain = false;
  let lastTop: Pull | null = null;
  for (const p of pulls) {
    if (p.top) {
      pity = 0;
      lastTop = p;
      if (group.featuredRule !== "none") {
        uncertain = p.featured === null;
        guaranteed = p.featured === false;
      }
    } else {
      pity++;
    }
  }

  const onBanner = rec.pulls.filter((p) => p.group === groupId && p.banner === banner);
  const bannerPulls = (baseOnThisBanner ? base.bannerPulls : 0) + onBanner.length;
  const featuredGot =
    (baseOnThisBanner && base.bannerFeaturedGot) || onBanner.some((p) => p.top && p.featured === true);

  const counters = group.bannerCounters.map((c): CounterStatus => {
    if (c.untilFeatured && featuredGot) return { label: c.label, at: c.at, remaining: 0, done: true };
    if (c.repeat) return { label: c.label, at: c.at, remaining: c.at - (bannerPulls % c.at), done: false };
    const remaining = Math.max(0, c.at - bannerPulls);
    return { label: c.label, at: c.at, remaining, done: remaining === 0 };
  });

  return {
    groupId,
    name: group.name,
    pity,
    hardPity: group.hardPity,
    softFrom: group.softFrom,
    guaranteed: group.featuredRule === "none" ? null : guaranteed,
    guaranteeUncertain: uncertain,
    banner,
    bannerPulls,
    counters,
    lastTop,
  };
}

export interface TopHit {
  pull: Pull;
  /** Pulls it took, counting the top pull itself (e.g. 74). */
  count: number;
}

/** Every top pull in a group with the number of pulls it took, oldest first. */
export function topHistory(rec: GameRecord, groupId: string): TopHit[] {
  const base = rec.baseline[groupId] ?? emptyBaseline();
  let since = base.pity;
  const hits: TopHit[] = [];
  for (const p of rec.pulls.filter((x) => x.group === groupId).sort(byTime)) {
    since++;
    if (p.top) {
      hits.push({ pull: p, count: since });
      since = 0;
    }
  }
  return hits;
}

/** Most recent pulls of a group, oldest first (for the history strip). */
export function recentPulls(rec: GameRecord, groupId: string, limit: number): Pull[] {
  return rec.pulls.filter((x) => x.group === groupId).sort(byTime).slice(-limit);
}

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

function newId(): string {
  return crypto.randomUUID();
}

export interface TopInfo {
  name: string | null;
  featured: boolean | null;
}

/**
 * Record a manual 1- or 10-pull. `tops` maps 0-based positions in the session to
 * top-rarity info; every other position is a non-top pull.
 */
export function recordSession(
  records: Records,
  game: GameId,
  groupId: string,
  count: number,
  tops: Map<number, TopInfo> = new Map(),
  now: Date = new Date(),
): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  const group = findGroup(game, groupId);
  const sessionId = newId();
  const time = now.toISOString();
  const banner = rec.currentBanner[groupId] ?? "";
  const added: Pull[] = [];
  for (let i = 0; i < count; i++) {
    const top = tops.get(i);
    added.push({
      id: newId(),
      time,
      game,
      group: groupId,
      banner,
      sessionId,
      indexInSession: i,
      top: !!top,
      name: top?.name ?? null,
      featured: top ? top.featured : null,
      source: "manual",
      confidence: 1,
      status: "confirmed",
    });
  }
  const prevCurrency = { ...rec.currency };
  rec.currency = deduct(rec.currency, group.spend, count).currency;
  rec.pulls.push(...added);
  pushUndo(next, {
    game,
    label: `${GAMES[game].shortName} ${group.name} ${count}회`,
    addedPullIds: added.map((p) => p.id),
    replacedPulls: [],
    prevCurrency,
  });
  return next;
}

/** Mark the n-th pull (0-based) of the most recent session in a group as top rarity. */
export function markTopInLastSession(
  records: Records,
  game: GameId,
  groupId: string,
  position: number,
  info: TopInfo,
): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  const last = rec.pulls.filter((p) => p.group === groupId).sort(byTime).at(-1);
  if (!last) throw new Error("기록된 뽑기가 없습니다");
  const target = rec.pulls.find((p) => p.sessionId === last.sessionId && p.indexInSession === position);
  if (!target) throw new Error(`직전 뽑기에 ${position + 1}번째가 없습니다`);
  const before = structuredClone(target);
  target.top = true;
  target.name = info.name;
  target.featured = info.featured;
  pushUndo(next, {
    game,
    label: `${GAMES[game].shortName} 최고 등급 표시`,
    addedPullIds: [],
    replacedPulls: [before],
    prevCurrency: { ...rec.currency },
  });
  return next;
}

export function lastSessionSize(rec: GameRecord, groupId: string): number {
  const last = rec.pulls.filter((p) => p.group === groupId).sort(byTime).at(-1);
  return last ? rec.pulls.filter((p) => p.sessionId === last.sessionId).length : 0;
}

export function setCurrency(
  records: Records,
  game: GameId,
  values: Record<string, number>,
  now: Date = new Date(),
): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  rec.currency = { ...rec.currency, ...values };
  rec.currencyUpdatedAt = now.toISOString();
  return next;
}

function pushUndo(records: Records, entry: Records["undo"][number]): void {
  records.undo.push(entry);
  if (records.undo.length > UNDO_LIMIT) records.undo.splice(0, records.undo.length - UNDO_LIMIT);
}

export function undo(records: Records): { records: Records; label: string | null } {
  const next = structuredClone(records);
  const entry = next.undo.pop();
  if (!entry) return { records, label: null };
  const rec = next.games[entry.game];
  const removed = new Set(entry.addedPullIds);
  rec.pulls = rec.pulls.filter((p) => !removed.has(p.id));
  for (const old of entry.replacedPulls) {
    const i = rec.pulls.findIndex((p) => p.id === old.id);
    if (i >= 0) rec.pulls[i] = old;
  }
  rec.currency = entry.prevCurrency;
  return { records: next, label: entry.label };
}
