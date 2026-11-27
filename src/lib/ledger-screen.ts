// 화면에서 읽은 값으로 기록 맞추기: 감지한 뽑기 기록, 화면 천장·누적 횟수에 맞추기, 결과 화면 기록 (정리 2026-11-27: ledger.ts에서 나눔)
import { GAMES, countersOf, findGroup } from "./games";
import type { Baseline, GameId, GameRecord, Records } from "./types";
import { byTime, groupStatus, recordSession, emptyBaseline, type TopInfo, markTopInLastSession } from "./ledger-core";

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
