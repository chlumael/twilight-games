// 기록 계산의 바탕: 빈 기록, 천장·확정·카운터 상태, 최고 등급 목록, 뽑기 기록, 되돌리기.
// 재화로 뽑을 수 있는 횟수는 ledger-spend.ts, 화면 인식으로 맞추기는 ledger-screen.ts, 직접 입력·고치기·지우기는 ledger-edit.ts (정리 2026-11-27).
// 다른 파일은 ledger.ts 하나만 불러 쓰면 된다.
import { GAMES, GAME_IDS, countersOf, findGroup } from "./games";
import type { Baseline, GameId, GameRecord, Pull, Records } from "./types";
import { deduct } from "./ledger-spend";


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

export function byTime(a: Pull, b: Pull): number {
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
/** 배너 id → 시리즈 (setSeriesOf로 정한 것) */
export const seriesOf: SeriesOf = (b) => seriesResolver(b);
/** 배너 데이터 팩을 읽은 뒤 시리즈 정보를 알려 준다 (App) */
export function setSeriesOf(fn: SeriesOf): void {
  seriesResolver = fn;
}

/** 지금 배너의 천장 계산에 들어가는 뽑기 (시간순) */
export function countedPulls(rec: GameRecord, game: GameId, groupId: string, seriesOf: SeriesOf = seriesResolver): Pull[] {
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

export function newId(): string {
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

export function pushUndo(records: Records, entry: Records["undo"][number]): void {
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
