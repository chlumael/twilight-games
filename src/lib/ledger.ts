import { GAMES, GAME_IDS, countersOf, findGroup, type SpendStep } from "./games";
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
  return repairBaselines(base); // 음수로 남은 기준값 고치기
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
  /** 픽업 확정 카운터인지 (예측·화면 맞추기에서 찾을 때 씀) */
  untilFeatured?: boolean;
  /** at회째가 아니라 그 뒤 "다음 최고 등급"이 확정인 카운터 */
  next?: boolean;
  /** 횟수를 채워 지금 적용 중 (다음 최고 등급이 픽업) */
  active?: boolean;
  /** 교환 카운터: 지금 가진 교환 재화 */
  held?: number;
  /** 교환 카운터: 고를 수 있는 교환 가격 */
  options?: { cost: number; label: string; low?: boolean }[];
  /** 교환 카운터: 배너가 끝나면 남은 재화가 바뀌는 것 */
  leftover?: { to: string; rate: number };
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
  /** 확정인 이유가 원신 「별빛 포착」(연속 픽뚫 3번)인지 */
  radiant: boolean;
  banner: string;
  bannerPulls: number;
  counters: CounterStatus[];
  lastTop: Pull | null;
  /** 한 번에 뽑는 단위(엔드필드 무기 신청 = 10, 그 밖은 1) */
  unit: number;
}

/** 배너 id → 시리즈 (엔드필드 재구축). 기본은 배너마다 다른 시리즈 */
export type SeriesOf = (bannerId: string) => string;
let seriesResolver: SeriesOf = (b) => b;
/** 배너 데이터 팩을 읽은 뒤 시리즈 정보를 알려 준다 (App) */
export function setSeriesOf(fn: SeriesOf): void {
  seriesResolver = fn;
}

/** 지금 배너의 천장 계산에 들어가는 뽑기 (시간순) */
function countedPulls(rec: GameRecord, game: GameId, groupId: string, seriesOf: SeriesOf = seriesResolver): Pull[] {
  const group = findGroup(game, groupId);
  const banner = rec.currentBanner[groupId] ?? "";
  let pulls = rec.pulls.filter((p) => p.group === groupId).sort(byTime);
  if (group.carryOver === false) pulls = pulls.filter((p) => p.banner === banner);
  else if (group.carryOver === "series") {
    const series = seriesOf(banner);
    pulls = pulls.filter((p) => p.banner === banner || (!!banner && seriesOf(p.banner) === series));
  }
  return pulls;
}

/** 픽업 확정 상태: 확정 여부, 연속 픽뚫 수, 별빛 포착으로 확정된 것인지 */
interface FeaturedState { guaranteed: boolean; losses: number; radiant: boolean }

/**
 * 최고 등급 하나가 나온 뒤의 확정 상태 (50:50 종류).
 * - 픽뚫 → 다음 확정, 연속 픽뚫 +1
 * - 50:50에서 픽업(또는 별빛 포착으로 확정된 픽업) → 연속 픽뚫 0
 * - 확정으로 픽업: 연속 픽뚫이 `streak`번 이상이면 다음도 확정(원신 별빛 포착), 아니면 다시 50:50
 * - 픽업 여부를 모르면 처음부터 다시 센다
 */
function afterTop(state: FeaturedState, featured: boolean | null, streak: number | undefined): FeaturedState {
  if (featured === null) return { guaranteed: false, losses: 0, radiant: false };
  if (featured === false) return { guaranteed: true, losses: state.losses + 1, radiant: false };
  if (state.guaranteed && !state.radiant && streak && state.losses >= streak) return { guaranteed: true, losses: state.losses, radiant: true };
  if (state.guaranteed && !state.radiant) return { guaranteed: false, losses: state.losses, radiant: false };
  return { guaranteed: false, losses: 0, radiant: false };
}

export function groupStatus(rec: GameRecord, game: GameId, groupId: string, seriesOf: SeriesOf = seriesResolver): GroupStatus {
  const group = findGroup(game, groupId);
  const banner = rec.currentBanner[groupId] ?? "";
  const base = rec.baseline[groupId] ?? emptyBaseline();
  const baseOnThisBanner = base.banner === banner;

  const pulls = countedPulls(rec, game, groupId, seriesOf);

  let pity = group.carryOver === true || baseOnThisBanner ? base.pity : 0;
  let state: FeaturedState = { guaranteed: base.guaranteed, losses: 0, radiant: false };
  let uncertain = false;
  let lastTop: Pull | null = null;
  for (const p of pulls) {
    if (p.top) {
      pity = 0;
      lastTop = p;
      if (group.featuredRule !== "none") {
        uncertain = p.featured === null;
        state = afterTop(state, p.featured, group.lossStreakGuarantee);
      }
    } else {
      pity++;
    }
  }
  let guaranteed = state.guaranteed;
  // 원신 무기·묶음 기원: 무기를 골랐으면(신의 궤도·묶음 궤도) 운명 포인트로 본다.
  // 포인트는 그 기원에서만 쌓이고 끝나면 0이 된다(공식) → 지금 배너에서 나온 마지막 최고 등급만 본다
  const chosen = group.featuredRule === "fate-point" ? rec.chosen?.[groupId] : undefined;
  if (chosen && chosen.banner === banner) {
    const last = [...pulls].reverse().find((p) => p.top && p.banner === banner);
    if (last?.name) {
      uncertain = false;
      guaranteed = last.name !== chosen.name;
    } else if (!last) {
      uncertain = false;
      guaranteed = baseOnThisBanner ? base.guaranteed : false;
    }
  }

  // 배너 카운터: 보통은 이 배너 것만, 시리즈 범위면 같은 시리즈 배너를 이어서 센다
  if (pity < 0) pity = 0; // 기준값이 음수로 남은 경우(아래 repairBaselines가 고친다)
  // 묶음 단위(엔드필드 무기 신청 10개): 묶음 안에서 최고 등급이 나오면 그 묶음까지로 천장이 끝난다
  // 그 밖에는 10의 배수로 올려서 본다(단뽑이 없으므로: 39 → 40, 62 → 70. 사용자 2026-11-26)
  const unit = group.odds?.unit ?? 1;
  if (unit > 1) {
    const top = lastTop as Pull | null;
    const sameBatch = top ? pulls.slice(pulls.indexOf(top) + 1).filter((p) => p.sessionId === top.sessionId).length : 0;
    pity = Math.ceil(Math.max(0, pity - sameBatch) / unit) * unit;
  }

  const onBanner = rec.pulls.filter((p) => p.group === groupId && (p.banner === banner ||
    (group.counterScope === "series" && !!banner && seriesOf(p.banner) === seriesOf(banner))));
  const bannerPulls = (baseOnThisBanner ? base.bannerPulls : 0) + onBanner.length;
  const featuredGot =
    (baseOnThisBanner && base.bannerFeaturedGot) || onBanner.some((p) => p.top && p.featured === true);

  // 픽업을 마지막으로 얻은 뒤 이 배너에서 뽑은 횟수 (얻은 적이 없으면 배너 누적)
  const lastFeatured = onBanner.map((p) => p.top && p.featured === true).lastIndexOf(true);
  const sinceFeatured = lastFeatured >= 0 ? onBanner.length - 1 - lastFeatured : bannerPulls;
  const counters = countersOf(group, banner).map((c): CounterStatus => {
    const flags = { untilFeatured: c.untilFeatured, next: c.next };
    if (c.untilFeatured && featuredGot) return { label: c.label, at: c.at, remaining: 0, done: true, ...flags };
    if (c.repeat) return { label: c.label, at: c.at, remaining: c.at - (bannerPulls % c.at), done: false };
    if (c.sinceFeatured) return { label: c.label, at: c.at, remaining: Math.max(0, c.at - sinceFeatured), done: false, untilFeatured: true };
    // 교환 카운터: 이미 교환한 만큼(at × 횟수) 빼고 남은 재화로 본다
    const used = c.exchange ? (rec.exchanges ?? []).filter((e) => !e.kind && e.group === groupId && e.banner === banner).reduce((n, e) => n + (e.cost ?? c.at), 0) : 0;
    const remaining = Math.max(0, c.at - (bannerPulls - used));
    if (c.exchange) {
      // 교환 재화를 지금 몇 개 갖고 있는지(뽑은 만큼 − 교환에 쓴 만큼)와 고를 수 있는 교환 가격
      const held = Math.max(0, bannerPulls - used);
      return { label: c.label, at: c.at, remaining, done: remaining === 0, held, ...(c.exchangeOptions ? { options: c.exchangeOptions } : {}), ...(c.leftover ? { leftover: c.leftover } : {}) };
    }
    // "다음 최고 등급이 픽업" 카운터는 횟수를 채우면 끝난 것이 아니라 그때부터 적용 중이다
    if (c.next) return { label: c.label, at: c.at, remaining, done: false, active: remaining === 0, ...flags };
    return { label: c.label, at: c.at, remaining, done: remaining === 0, ...flags };
  });

  return {
    groupId,
    name: group.name,
    pity,
    hardPity: group.hardPity,
    softFrom: group.softFrom,
    guaranteed: group.featuredRule === "none" ? null : guaranteed,
    guaranteeUncertain: uncertain,
    radiant: group.featuredRule !== "none" && state.radiant && guaranteed,
    banner,
    bannerPulls,
    counters,
    lastTop,
    unit,
  };
}

export interface TopHit {
  pull: Pull;
  /** Pulls it took, counting the top pull itself (e.g. 74). */
  count: number;
  /** 그 배너에서 몇 번째 뽑기였는지 (배너 누적). 화면에는 이 숫자를 크게 보여 준다(사용자 2026-11-26) */
  at: number;
  /**
   * 천장으로 얻었는지 (사용자 2026-11-26). half = 반천(확률 상승 구간~최고 등급 확정 천장에서 나옴),
   * full = 확천(픽업 확정 천장: 엔드필드 120회·무기 80개, 원신은 확정 상태에서 천장). 천장이 아니면 null
   */
  ceiling: "half" | "full" | null;
}

/** 표시용: "픽업/확천", "픽뚫/반천", "픽업", "반천" … 표시할 것이 없으면 "" */
export function hitLabel(h: TopHit): string {
  const a = h.pull.featured === true ? "픽업" : h.pull.featured === false ? "픽뚫" : "";
  const b = h.ceiling === "full" ? "확천" : h.ceiling === "half" ? "반천" : "";
  return [a, b].filter(Boolean).join("/");
}

/** Every top pull in a group with the number of pulls it took, oldest first. */
export function topHistory(rec: GameRecord, groupId: string): TopHit[] {
  const base = rec.baseline[groupId] ?? emptyBaseline();
  const group = GAME_IDS.flatMap((g) => GAMES[g].groups).find((g) => g.id === groupId);
  /** 배너별 픽업 확정 카운터 */
  const featuredCounter = (bannerId: string) => (group ? countersOf(group, bannerId).find((c) => c.untilFeatured || c.sinceFeatured) : undefined);
  const gotFeatured = new Set<string>(base.banner && base.bannerFeaturedGot ? [base.banner] : []);
  const sinceFeatured = new Map<string, number>(); // 배너별: 픽업을 마지막으로 얻은 뒤 뽑은 횟수
  // 이월 안 되는 종류(명일방주, 무기고 등)는 배너마다 따로 센다
  const perBanner = group?.carryOver === false;
  let since = perBanner ? 0 : base.pity;
  let lastBanner: string | null = null;
  let seen = 0; // 직전 최고 등급 이후 기록된 뽑기 수
  let state: FeaturedState = { guaranteed: base.guaranteed, losses: 0, radiant: false };
  const onBanner = new Map<string, number>(base.banner ? [[base.banner, base.bannerPulls]] : []);
  const hits: TopHit[] = [];
  for (const p of rec.pulls.filter((x) => x.group === groupId).sort(byTime)) {
    if (perBanner && p.banner !== lastBanner) {
      since = p.banner === base.banner ? base.pity : 0;
      lastBanner = p.banner;
    }
    since++;
    seen++;
    const n = (onBanner.get(p.banner) ?? 0) + 1;
    onBanner.set(p.banner, n);
    sinceFeatured.set(p.banner, (sinceFeatured.get(p.banner) ?? n - 1) + 1);
    if (p.top) {
      // 묶음 단위(엔드필드 무기 신청 10개)는 묶음 끝으로 올려서 본다
      const unit = group?.odds?.unit ?? 1;
      const up = (v: number) => Math.ceil(v / unit) * unit;
      // 확률 상승 구간에서 나온 것도 천장으로 친다(사용자 2026-11-26). 상승 구간이 없으면 천장 회차만
      const from = group?.softFrom ?? group?.hardPity ?? null;
      const atHard = from !== null && up(since) >= from;
      let ceiling: TopHit["ceiling"] = null;
      // 픽업 확정 카운터로 얻은 픽업 = 확천. 종류에 따라: at회째 / at회가 지난 뒤 첫 픽업 / 픽업 뒤 다시 센 at회째
      const fc = featuredCounter(p.banner);
      const sf = sinceFeatured.get(p.banner) ?? n;
      const byCounter = !!fc && p.featured === true && (
        fc.sinceFeatured ? up(sf) === fc.at
        : fc.next ? n > fc.at && !gotFeatured.has(p.banner)
        : up(n) === fc.at);
      if (byCounter) ceiling = "full";
      else if (atHard) ceiling = group?.featuredRule !== "none" && state.guaranteed ? "full" : "half";
      // 기준값이 음수라(화면 값에 맞추느라 뺀 뒤 기록을 지운 경우) 횟수가 0 이하로 나오면, 기록된 뽑기 수로 센다
      hits.push({ pull: p, count: up(since > 0 ? since : seen), at: up(n), ceiling });
      since = 0;
      seen = 0;
      if (group && group.featuredRule !== "none") state = afterTop(state, p.featured, group.lossStreakGuarantee);
      if (p.featured === true) {
        gotFeatured.add(p.banner);
        sinceFeatured.set(p.banner, 0);
      }
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
  // 뽑으면서 함께 받는 재화 (엔드필드 무기고 징표)
  if (group.gain) {
    const topN = added.filter((p) => p.top).length;
    rec.currency[group.gain.key] = (rec.currency[group.gain.key] ?? 0) + topN * group.gain.top + (count - topN) * group.gain.other;
  }
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
  const prevCurrency = { ...rec.currency };
  // 방금 뽑은 것 중 하나가 최고 등급으로 밝혀졌으면 받는 재화도 그만큼 더한다
  const gain = findGroup(game, groupId).gain;
  if (gain && !target.top) rec.currency[gain.key] = (rec.currency[gain.key] ?? 0) + gain.top - gain.other;
  target.top = true;
  target.name = info.name;
  target.featured = info.featured;
  pushUndo(next, {
    game,
    label: `${GAMES[game].shortName} 최고 등급 표시`,
    addedPullIds: [],
    replacedPulls: [before],
    prevCurrency,
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
    else rec.pulls.push(old); // 지워졌던 뽑기(공식 기록 반영·기록 정리)는 다시 넣는다
  }
  rec.currency = entry.prevCurrency;
  return { records: next, label: entry.label };
}

/**
 * 화면에서 감지한 뽑기를 기록한다. 최고 등급은 tops처럼, 그 아래 등급은 이름·등급만 붙인다.
 * 한 번에 뽑은 것 안에서의 순서는 알 수 없어서, 최고 등급을 맨 뒤 자리에 둔다
 * (그래서 다음 천장 계산이 최대 9회까지 적게 나올 수 있다 — 게임 기록 화면 읽기로 보정 예정).
 */
export function recordDetected(
  records: Records,
  game: GameId,
  groupId: string,
  count: number,
  items: { name: string; rarity: number; top: boolean; featured: boolean | null }[],
  after: Record<string, number>,
  now: Date,
): Records {
  const tops = items.filter((i) => i.top).slice(-count);
  const lower = items.filter((i) => !i.top).slice(0, count - tops.length);
  const map = new Map<number, TopInfo>();
  tops.forEach((t, k) => map.set(count - tops.length + k, { name: t.name, featured: t.featured }));
  const next = recordSession(records, game, groupId, count, map, now);
  const added = new Set(next.undo[next.undo.length - 1]?.addedPullIds ?? []);
  const rec = next.games[game];
  const session = rec.pulls.filter((p) => added.has(p.id)).sort((a, b) => a.indexInSession - b.indexInSession);
  for (const p of session) {
    p.source = "screen";
    if (p.top) p.rarity = items.find((i) => i.top && i.name === p.name)?.rarity ?? null;
  }
  lower.forEach((it, k) => {
    const p = session[k];
    if (p && !p.top) { p.name = it.name; p.rarity = it.rarity; }
  });
  // 앱이 따라가던 재화보다 화면에서 읽은 값이 정확하다
  for (const [k, v] of Object.entries(after)) rec.currency[k] = v;
  rec.currencyUpdatedAt = now.toISOString();
  return next;
}

/**
 * 지금 배너 기준의 기준값. 기준값이 다른 배너 것이면, 지금 계산 결과가 그대로 유지되도록 지금 배너 것으로 바꿔 준다
 * (이월되는 그룹은 천장 스택을 남기고, 이월 안 되는 그룹은 0부터. 배너 누적 횟수는 0부터).
 */
function baseForBanner(rec: GameRecord, game: GameId, groupId: string, banner: string): Baseline {
  const b0 = { ...emptyBaseline(), ...(rec.baseline[groupId] ?? {}) };
  if (b0.banner === banner) return b0;
  const group = findGroup(game, groupId);
  return { ...emptyBaseline(), banner, pity: group.carryOver === true ? b0.pity : 0, guaranteed: b0.guaranteed };
}

/**
 * 게임 화면에 적힌 "N회 내 최고 등급 확정"·"N회 내 픽업 확정"에 앱의 수치를 맞춘다.
 * 뽑기 기록은 건드리지 않고, 앱이 못 본 과거를 나타내는 기준값(baseline)만 고친다.
 * 바꿀 것이 없으면 받은 records를 그대로 돌려준다.
 */
export function syncPityFromScreen(
  records: Records,
  game: GameId,
  groupId: string,
  toTop: number | null,
  toFeatured: number | null,
): Records {
  const group = findGroup(game, groupId);
  const rec = records.games[game];
  const status = groupStatus(rec, game, groupId);
  const base = baseForBanner(rec, game, groupId, status.banner);
  let changed = false;
  if (toTop !== null && group.hardPity !== null && toTop >= 1 && toTop <= group.hardPity) {
    const delta = group.hardPity - toTop - status.pity;
    if (delta !== 0) {
      base.pity += delta;
      changed = true;
    }
  }
  const counter = countersOf(group, status.banner).find((c) => c.untilFeatured && !c.next);
  if (toFeatured !== null && counter && toFeatured >= 1 && toFeatured <= counter.at) {
    const target = counter.at - toFeatured;
    if (status.bannerPulls !== target || base.bannerFeaturedGot) {
      const recorded = status.bannerPulls - base.bannerPulls;
      base.bannerPulls = target - recorded;
      base.bannerFeaturedGot = false;
      changed = true;
    }
  }
  if (!changed) return records;
  const next = structuredClone(records);
  next.games[game].baseline[groupId] = base;
  next.games[game].updatedAt = new Date().toISOString();
  return next;
}

/**
 * 화면의 "N회 내 최고 등급 확정"이 줄어든 것(=천장이 다시 시작됨)을 보고, 직전에 기록한 뽑기 안에서 최고 등급이 나온 자리를 찾아 표시한다.
 * 화면 값으로 계산한 지금 천장(newPity)이 직전 묶음 크기보다 작으면, 그 묶음의 뒤에서 newPity+1번째가 최고 등급이다.
 * 픽업 확정 문구가 아직 보이면(toFeatured) 픽업이 아니다(픽뚫). 이름은 모른다(기록 화면에서 채운다).
 * 바꿀 것이 없으면 받은 records를 그대로 돌려준다.
 */
export function inferTopFromScreen(
  records: Records,
  game: GameId,
  groupId: string,
  toTop: number | null,
  toFeatured: number | null,
  now: Date = new Date(),
): Records {
  const group = findGroup(game, groupId);
  if (toTop === null || group.hardPity === null || toTop < 1 || toTop > group.hardPity) return records;
  const rec = records.games[game];
  const newPity = group.hardPity - toTop;
  const status = groupStatus(rec, game, groupId);
  if (newPity >= status.pity) return records; // 천장이 다시 시작되지 않았다
  const last = rec.pulls.filter((p) => p.group === groupId).sort(byTime).at(-1);
  if (!last) return records;
  // 오래전 묶음에는 붙이지 않는다 (방금 뽑은 것만)
  if (now.getTime() - new Date(last.time).getTime() > 30 * 60 * 1000) return records;
  const session = rec.pulls.filter((p) => p.sessionId === last.sessionId);
  if (session.some((p) => p.top) || newPity >= session.length) return records;
  const position = session.length - newPity - 1;
  return markTopInLastSession(records, game, groupId, position, { name: null, featured: toFeatured !== null ? false : null });
}

/**
 * 결과 화면으로 센 뽑기를 기록한다. tops = 최고 등급이 나온 자리(0부터). 이름·픽업 여부는 모른다(기록 화면·기원 기록에서 채움).
 */
export function recordResult(
  records: Records,
  game: GameId,
  groupId: string,
  count: number,
  tops: number[],
  now: Date = new Date(),
): Records {
  const map = new Map<number, TopInfo>(tops.filter((i) => i >= 0 && i < count).map((i) => [i, { name: null, featured: null }]));
  const next = recordSession(records, game, groupId, count, map, now);
  const added = new Set(next.undo[next.undo.length - 1]?.addedPullIds ?? []);
  for (const p of next.games[game].pulls) if (added.has(p.id)) p.source = "screen";
  const last = next.undo[next.undo.length - 1];
  if (last) last.label = `${GAMES[game].shortName} ${findGroup(game, groupId).name} ${count}회 (결과 화면)`;
  return next;
}

/** 화면에 보이는 배너 누적 횟수(명일방주 300회, 림버스 200회 교환)에 앱의 값을 맞춘다. 같으면 그대로 돌려준다 */
export function syncBannerPulls(records: Records, game: GameId, groupId: string, value: number): Records {
  const rec = records.games[game];
  const status = groupStatus(rec, game, groupId);
  if (status.bannerPulls === value || value < 0) return records;
  const base = baseForBanner(rec, game, groupId, status.banner);
  base.bannerPulls = value - (status.bannerPulls - base.bannerPulls);
  const next = structuredClone(records);
  next.games[game].baseline[groupId] = base;
  next.games[game].updatedAt = new Date().toISOString();
  return next;
}

/** 천장 스택을 0부터 다시 센다 (명일방주 일반 배너가 바뀌었는데 이어가지 않기로 한 경우). 이미 0이면 그대로 */
export function resetPity(records: Records, game: GameId, groupId: string): Records {
  const rec = records.games[game];
  const status = groupStatus(rec, game, groupId);
  if (status.pity === 0) return records;
  const base = baseForBanner(rec, game, groupId, status.banner);
  base.pity -= status.pity;
  const next = structuredClone(records);
  next.games[game].baseline[groupId] = base;
  next.games[game].updatedAt = new Date().toISOString();
  return next;
}

/**
 * 직접 입력: "이 배너에서 n번째 뽑기에 최고 등급(이름)이 나왔다" — n은 **배너 누적**(사용자 결정 2026-11-26).
 * 예: 58 → 92 → 120 순서로 넣으면 차이(34, 28)만큼만 뽑기를 더한다.
 * - n이 지금 배너 누적보다 크면: 모자란 뽑기를 더하고 마지막을 최고 등급으로 (mode "added")
 * - 이미 기록된 뽑기 자리면: 그 자리를 최고 등급으로 표시 (mode "marked")
 * - 앱 기록 전 구간(시작 상태의 배너 뽑기 수 안)이면 바꾸지 않는다 (mode "before")
 * - 더하면 천장을 넘는 경우(그 사이에 다른 최고 등급이 있었을 것)면 바꾸지 않는다 (mode "too-far")
 * 묶음 단위(엔드필드 무기 신청)는 10의 배수로 올린다. 픽업 여부는 배너의 픽업 이름과 같은지로 정해서 넘긴다.
 */
export function recordTopAt(
  records: Records,
  game: GameId,
  groupId: string,
  n: number,
  info: TopInfo,
  now: Date = new Date(),
): { records: Records; mode: "added" | "marked" | "before" | "too-far" | "invalid" } {
  const rec = records.games[game];
  const group = findGroup(game, groupId);
  const unit = group.odds?.unit ?? 1;
  n = Math.ceil(n / unit) * unit;
  if (!Number.isInteger(n) || n < 1 || n > 2000) return { records, mode: "invalid" };
  const st = groupStatus(rec, game, groupId);
  const banner = st.banner;
  const base = rec.baseline[groupId];
  const before = base && base.banner === banner ? base.bannerPulls : 0; // 앱이 못 본 배너 뽑기
  const onBanner = rec.pulls
    .filter((p) => p.group === groupId && (p.banner === banner || (group.counterScope === "series" && !!banner && seriesResolver(p.banner) === seriesResolver(banner))))
    .sort(byTime);
  if (n > st.bannerPulls) {
    const add = n - st.bannerPulls;
    if (group.hardPity !== null && st.pity + add > group.hardPity) return { records, mode: "too-far" };
    const next = recordSession(records, game, groupId, add, new Map([[add - 1, info]]), now);
    // 지난 뽑기를 뒤늦게 적는 것이므로 지금 보유 재화는 깎지 않는다
    next.games[game].currency = { ...rec.currency };
    const last = next.undo[next.undo.length - 1];
    if (last) last.label = `${GAMES[game].shortName} 배너 ${n}번째 ${info.name ?? GAMES[game].topLabel} 직접 입력`;
    return { records: next, mode: "added" };
  }
  if (n <= before) return { records, mode: "before" };
  const target = onBanner[n - before - 1];
  if (!target) return { records, mode: "invalid" };
  const next = structuredClone(records);
  const p = next.games[game].pulls.find((x) => x.id === target.id)!;
  const old = structuredClone(p);
  p.top = true;
  p.name = info.name;
  p.featured = info.featured;
  pushUndo(next, { game, label: `${GAMES[game].shortName} 배너 ${n}번째 ${info.name ?? GAMES[game].topLabel} 표시`, addedPullIds: [], replacedPulls: [old], prevCurrency: { ...next.games[game].currency } });
  return { records: next, mode: "marked" };
}

/** 기록 묶음(한 번에 기록된 뽑기들) — 기록 정리 화면용. 최근 것부터 */
export interface PullBatch {
  sessionId: string;
  group: string;
  time: string;
  count: number;
  source: Pull["source"];
  tops: string[];
}

export function pullBatches(rec: GameRecord): PullBatch[] {
  const map = new Map<string, PullBatch>();
  for (const p of rec.pulls) {
    const key = `${p.sessionId}|${p.group}|${p.source}`;
    const b = map.get(key) ?? { sessionId: key, group: p.group, time: p.time, count: 0, source: p.source, tops: [] };
    b.count++;
    if (p.time < b.time) b.time = p.time;
    if (p.top) b.tops.push(p.name ?? "이름 없음");
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => (a.time < b.time ? 1 : -1));
}

/** 기록 묶음을 지운다(되돌리기 가능). keys = pullBatches의 sessionId */
export function removeBatches(records: Records, game: GameId, keys: string[], label: string): Records {
  const want = new Set(keys);
  const next = structuredClone(records);
  const rec = next.games[game];
  const gone = rec.pulls.filter((p) => want.has(`${p.sessionId}|${p.group}|${p.source}`));
  if (!gone.length) return records;
  const ids = new Set(gone.map((p) => p.id));
  rec.pulls = rec.pulls.filter((p) => !ids.has(p.id));
  pushUndo(next, { game, label, addedPullIds: [], replacedPulls: gone, prevCurrency: { ...rec.currency } });
  return repairBaselines(next);
}

/**
 * 같은 종류의 다음 배너로 넘어갈 때 규칙대로 재화를 바꾼다 (엔드필드 특별 허가, 사용자 2026-11-26):
 * - 그 배너가 끝나면 사라지는 재화(`expiresWith`)는 0으로
 * - 지난 배너에서 누적 at회를 채워 받은 "다음 배너 보상"(`bonuses[].nextBanner`)은 그 재화로 더한다
 * 배너는 아직 바꾸지 않은 상태(지난 배너가 currentBanner)에서 불러야 한다. 바뀐 내용을 글로 돌려준다.
 */
export function carryToNextBanner(records: Records, game: GameId, groupId: string, seriesOf?: (banner: string) => string): { records: Records; notes: string[] } {
  const def = GAMES[game];
  const group = def.groups.find((g) => g.id === groupId);
  if (!group || !records.games[game].currentBanner[groupId]) return { records, notes: [] };
  const expiring = def.currencies.filter((c) => c.expiresWith === groupId);
  const carried = (group.bonuses ?? []).filter((b) => b.nextBanner);
  if (!expiring.length && !carried.length) return { records, notes: [] };
  const pulls = groupStatus(records.games[game], game, groupId, seriesOf).bannerPulls;
  const next = structuredClone(records);
  const cur = next.games[game].currency;
  const notes: string[] = [];
  const label = (key: string) => def.currencies.find((c) => c.key === key)?.label ?? key;
  for (const c of expiring) {
    if ((cur[c.key] ?? 0) > 0) notes.push(`${c.label} ${cur[c.key]}개 소멸`);
    cur[c.key] = 0;
  }
  for (const b of carried) {
    if (pulls < b.at) continue;
    cur[b.nextBanner!] = (cur[b.nextBanner!] ?? 0) + b.pulls;
    notes.push(`${label(b.nextBanner!)} +${b.pulls}`);
  }
  return { records: next, notes };
}

/** 교환으로 얻은 최고 등급을 기록한다(뽑기 수·천장에는 영향 없음, 교환 재화만 줄어든다) */
export function recordExchange(records: Records, game: GameId, groupId: string, name: string | null, now: Date = new Date(), option?: { cost: number; low?: boolean }): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  rec.exchanges = [...(rec.exchanges ?? []), {
    id: newId(), time: now.toISOString(), group: groupId, banner: rec.currentBanner[groupId] ?? "", name,
    ...(option ? { cost: option.cost } : {}), ...(option?.low ? { low: true } : {}),
  }];
  return next;
}

/**
 * 무료 뽑기(엔드필드 긴급 모집)에서 나온 최고 등급을 기록한다.
 * 공식 규칙: 긴급 모집은 천장 횟수·누적 횟수에 들어가지 않는다 → 뽑기 수·천장·재화(허가증·오로베릴)는 그대로 두고,
 * 오퍼레이터를 얻을 때 함께 받는 재화(무기고 징표 6성분)만 더한다.
 */
export function recordFreeTop(records: Records, game: GameId, groupId: string, info: TopInfo, now: Date = new Date()): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  const group = GAMES[game].groups.find((g) => g.id === groupId);
  if (!group?.freeLabel) return records;
  rec.exchanges = [...(rec.exchanges ?? []), {
    id: newId(), time: now.toISOString(), group: groupId, banner: rec.currentBanner[groupId] ?? "",
    name: info.name ?? null, kind: "free", featured: info.featured ?? null,
  }];
  if (group.gain) rec.currency[group.gain.key] = (rec.currency[group.gain.key] ?? 0) + group.gain.top;
  return next;
}

export function removeExchange(records: Records, game: GameId, id: string): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  const gone = (rec.exchanges ?? []).find((e) => e.id === id);
  rec.exchanges = (rec.exchanges ?? []).filter((e) => e.id !== id);
  // 무료 뽑기 기록을 지우면 그때 더한 재화도 되돌린다
  const gain = gone?.kind === "free" ? GAMES[game].groups.find((g) => g.id === gone.group)?.gain : undefined;
  if (gain) rec.currency[gain.key] = Math.max(0, (rec.currency[gain.key] ?? 0) - gain.top);
  return next;
}

/**
 * 천장 스택이 음수가 되지 않게 기준값을 고친다. 화면 값에 맞추느라 기준값을 뺀 뒤(잘못 들어간 기록이 있을 때)
 * 그 기록을 지우면 기준값만 음수로 남아 "−64뽑"처럼 보이던 문제(2026-11-26). 바꿀 것이 없으면 그대로 돌려준다.
 */
export function repairBaselines(records: Records): Records {
  let next: Records | null = null;
  for (const game of GAME_IDS) {
    for (const group of GAMES[game].groups) {
      const rec = (next ?? records).games[game];
      const base = rec.baseline[group.id];
      if (!base || base.pity >= 0) continue;
      // 마지막 최고 등급 이후 기록된 뽑기 수 + 기준값이 음수면 그만큼 올린다
      const pulls = countedPulls(rec, game, group.id);
      const lastTop = pulls.map((p) => p.top).lastIndexOf(true);
      const raw = lastTop >= 0 ? 0 : base.pity + pulls.length;
      const fixed = lastTop >= 0 ? 0 : base.pity - Math.min(0, raw);
      if (fixed === base.pity) continue;
      next ??= structuredClone(records);
      next.games[game].baseline[group.id] = { ...base, pity: fixed };
    }
  }
  return next ?? records;
}

/**
 * 직접 입력: "이 배너에서 지금까지 n번 뽑았다"(최고 등급 없이 횟수만 맞추기, 배너 누적).
 * 지금 누적보다 크면 차이만큼 뽑기를 더한다. 더하면 천장에 닿는 경우는 받지 않는다(그 안에 최고 등급이 나왔을 것).
 */
export function recordPullsTo(
  records: Records,
  game: GameId,
  groupId: string,
  n: number,
  now: Date = new Date(),
): { records: Records; mode: "added" | "too-far" | "invalid" } {
  const group = findGroup(game, groupId);
  const unit = group.odds?.unit ?? 1;
  n = Math.ceil(n / unit) * unit;
  const st = groupStatus(records.games[game], game, groupId);
  if (!Number.isInteger(n) || n <= st.bannerPulls || n > 2000) return { records, mode: "invalid" };
  const add = n - st.bannerPulls;
  if (group.hardPity !== null && st.pity + add >= group.hardPity) return { records, mode: "too-far" };
  const next = recordSession(records, game, groupId, add, new Map(), now);
  next.games[game].currency = { ...records.games[game].currency }; // 지난 뽑기 → 재화는 그대로
  const last = next.undo[next.undo.length - 1];
  if (last) last.label = `${GAMES[game].shortName} 배너 ${n}번째까지 횟수 맞추기`;
  return { records: next, mode: "added" };
}

/** 한 종류의 기록을 전부 지우고 시작 상태(기준값)·교환 기록도 비운다. 뽑기는 되돌리기로 복구할 수 있다(시작 상태는 복구 안 됨) */
export function resetGroup(records: Records, game: GameId, groupId: string): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  const gone = rec.pulls.filter((p) => p.group === groupId);
  rec.pulls = rec.pulls.filter((p) => p.group !== groupId);
  rec.baseline[groupId] = emptyBaseline(); // 지우지 않고 빈 값으로(다른 기기와 합칠 때 예전 값이 되살아나지 않게)
  rec.exchanges = (rec.exchanges ?? []).filter((e) => e.group !== groupId);
  pushUndo(next, { game, label: `${GAMES[game].shortName} ${findGroup(game, groupId).name} 기록 전부 지우기`, addedPullIds: [], replacedPulls: gone, prevCurrency: { ...rec.currency } });
  return next;
}
