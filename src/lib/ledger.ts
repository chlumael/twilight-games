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

export function groupStatus(rec: GameRecord, game: GameId, groupId: string, seriesOf: SeriesOf = seriesResolver): GroupStatus {
  const group = findGroup(game, groupId);
  const banner = rec.currentBanner[groupId] ?? "";
  const base = rec.baseline[groupId] ?? emptyBaseline();
  const baseOnThisBanner = base.banner === banner;

  const pulls = countedPulls(rec, game, groupId, seriesOf);

  let pity = group.carryOver === true || baseOnThisBanner ? base.pity : 0;
  let guaranteed = base.guaranteed;
  let uncertain = false;
  let lastTop: Pull | null = null;
  for (const p of pulls) {
    if (p.top) {
      pity = 0;
      lastTop = p;
      if (group.featuredRule !== "none") {
        // 원신 무기·집록: 고른 무기(신각의 길)가 있으면 그 이름이 아니면 다음 확정
        const chosen = group.featuredRule === "fate-point" ? rec.chosen?.[groupId] : undefined;
        if (chosen && chosen.banner === p.banner && p.name) {
          uncertain = false;
          guaranteed = p.name !== chosen.name;
        } else {
          uncertain = p.featured === null;
          guaranteed = p.featured === false;
        }
      }
    } else {
      pity++;
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

  const counters = group.bannerCounters.map((c): CounterStatus => {
    if (c.untilFeatured && featuredGot) return { label: c.label, at: c.at, remaining: 0, done: true };
    if (c.repeat) return { label: c.label, at: c.at, remaining: c.at - (bannerPulls % c.at), done: false };
    // 교환 카운터: 이미 교환한 만큼(at × 횟수) 빼고 남은 재화로 본다
    const used = c.exchange ? c.at * (rec.exchanges ?? []).filter((e) => e.group === groupId && e.banner === banner).length : 0;
    const remaining = Math.max(0, c.at - (bannerPulls - used));
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
    unit,
  };
}

export interface TopHit {
  pull: Pull;
  /** Pulls it took, counting the top pull itself (e.g. 74). */
  count: number;
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
  const featuredAt = group?.bannerCounters.find((c) => c.untilFeatured)?.at ?? null;
  // 이월 안 되는 종류(명일방주, 무기고 등)는 배너마다 따로 센다
  const perBanner = group?.carryOver === false;
  let since = perBanner ? 0 : base.pity;
  let lastBanner: string | null = null;
  let seen = 0; // 직전 최고 등급 이후 기록된 뽑기 수
  let guaranteed = base.guaranteed;
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
    if (p.top) {
      // 묶음 단위(엔드필드 무기 신청 10개)는 묶음 끝으로 올려서 본다
      const unit = group?.odds?.unit ?? 1;
      const up = (v: number) => Math.ceil(v / unit) * unit;
      // 확률 상승 구간에서 나온 것도 천장으로 친다(사용자 2026-11-26). 상승 구간이 없으면 천장 회차만
      const from = group?.softFrom ?? group?.hardPity ?? null;
      const atHard = from !== null && up(since) >= from;
      let ceiling: TopHit["ceiling"] = null;
      if (featuredAt !== null && up(n) === featuredAt && p.featured === true) ceiling = "full";
      else if (atHard) ceiling = group?.featuredRule !== "none" && guaranteed ? "full" : "half";
      // 기준값이 음수라(화면 값에 맞추느라 뺀 뒤 기록을 지운 경우) 횟수가 0 이하로 나오면, 기록된 뽑기 수로 센다
      hits.push({ pull: p, count: up(since > 0 ? since : seen), ceiling });
      since = 0;
      seen = 0;
      if (group && group.featuredRule !== "none") guaranteed = p.featured === false;
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
  const counter = group.bannerCounters.find((c) => c.untilFeatured);
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
 * 직접 입력: "n뽑에 최고 등급(이름)이 나왔다". n은 직전 최고 등급 이후 몇 번째인지(예: 32스택에서 10연 7번째 → 39).
 * - n이 지금 스택보다 크면: 모자란 뽑기를 더하고 마지막을 최고 등급으로 (아직 기록 안 된 뽑기)
 * - 이미 기록된 뽑기 안이면: 그 자리를 최고 등급으로 표시
 * - 앱이 기록하기 전(시작 상태) 구간이면: 천장 스택만 n만큼 줄인다
 * 픽업 여부는 배너의 픽업 이름과 같은지로 정해서 넘긴다(모르면 null).
 */
export function recordTopAt(
  records: Records,
  game: GameId,
  groupId: string,
  n: number,
  info: TopInfo,
  now: Date = new Date(),
): { records: Records; mode: "added" | "marked" | "baseline" } {
  const rec = records.games[game];
  const st = groupStatus(rec, game, groupId);
  // 천장보다 큰 숫자는 받지 않는다(잘못 넣으면 그만큼 뽑기가 더해지므로)
  const hard = findGroup(game, groupId).hardPity;
  // 묶음 단위(엔드필드 무기 신청)는 10의 배수로 올린다: 39 → 40
  const unit = findGroup(game, groupId).odds?.unit ?? 1;
  n = Math.ceil(n / unit) * unit;
  if (!Number.isInteger(n) || n < 1 || (hard !== null && n > hard)) return { records, mode: "baseline" };
  const pulls = countedPulls(rec, game, groupId);
  const lastTop = pulls.map((p) => p.top).lastIndexOf(true);
  const since = pulls.slice(lastTop + 1);
  const before = st.pity - since.length; // 시작 상태(앱이 못 본 구간)에서 온 스택
  if (n > st.pity) {
    const add = n - st.pity;
    const next = recordSession(records, game, groupId, add, new Map([[add - 1, info]]), now);
    const last = next.undo[next.undo.length - 1];
    if (last) last.label = `${GAMES[game].shortName} ${n}뽑 ${info.name ?? GAMES[game].topLabel} 직접 입력`;
    return { records: next, mode: "added" };
  }
  if (n > before) {
    const target = since[n - before - 1];
    const next = structuredClone(records);
    const p = next.games[game].pulls.find((x) => x.id === target.id)!;
    const old = structuredClone(p);
    p.top = true;
    p.name = info.name;
    p.featured = info.featured;
    pushUndo(next, { game, label: `${GAMES[game].shortName} ${n}뽑 ${info.name ?? GAMES[game].topLabel} 표시`, addedPullIds: [], replacedPulls: [old], prevCurrency: { ...next.games[game].currency } });
    return { records: next, mode: "marked" };
  }
  const base = baseForBanner(rec, game, groupId, st.banner);
  base.pity -= n;
  const next = structuredClone(records);
  next.games[game].baseline[groupId] = base;
  next.games[game].updatedAt = new Date().toISOString();
  return { records: next, mode: "baseline" };
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

/** 교환으로 얻은 최고 등급을 기록한다(뽑기 수·천장에는 영향 없음, 교환 재화만 줄어든다) */
export function recordExchange(records: Records, game: GameId, groupId: string, name: string | null, now: Date = new Date()): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  rec.exchanges = [...(rec.exchanges ?? []), { id: newId(), time: now.toISOString(), group: groupId, banner: rec.currentBanner[groupId] ?? "", name }];
  return next;
}

export function removeExchange(records: Records, game: GameId, id: string): Records {
  const next = structuredClone(records);
  next.games[game].exchanges = (next.games[game].exchanges ?? []).filter((e) => e.id !== id);
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
