// 통계: 기록에서 계산하는 요약값. 운 등급만 게임 확률(games.ts의 odds)을 써서 "평균 운 기준 상위 몇 %"를 계산한다.
import { GAMES, type PityGroup } from "./games";
import { topHistory, type TopHit } from "./ledger";
import type { GameId, GameRecord, Pull } from "./types";

export interface GroupStats {
  groupId: string;
  name: string;
  /** 기록된 뽑기 수 (앱에 기록하기 전 뽑기는 포함하지 않음) */
  pulls: number;
  /** 최고 등급 획득 수 */
  tops: number;
  /** 최고 등급 하나를 얻는 데 든 평균 뽑기 수 */
  average: number | null;
  best: number | null;
  worst: number | null;
  /** 마지막 최고 등급 이후 뽑기 수 */
  since: number;
  /** 픽업 여부가 기록된 최고 등급 중 픽업 비율 (0~1) */
  featuredRate: number | null;
  featuredWon: number;
  featuredLost: number;
  /** 평균 뽑기 수 ÷ 천장. 낮을수록 운이 좋다. 천장이 없으면 null */
  pityRatio: number | null;
  hits: TopHit[];
  /** 화면에서 읽어 이름이 남은 한 단계 아래 등급(원신 4성) — 최근 것부터 */
  rare: Pull[];
}

export interface BannerStats {
  banner: string;
  groupId: string;
  pulls: number;
  tops: Pull[];
  first: string;
  last: string;
}

export interface GameStats {
  game: GameId;
  pulls: number;
  tops: number;
  average: number | null;
  /** 기본 재화로 환산한 사용량 (뽑기 수 × 1회 비용) */
  spent: { key: string; label: string; amount: number } | null;
  groups: GroupStats[];
  banners: BannerStats[];
  firstPull: string | null;
  lastPull: string | null;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function groupStats(rec: GameRecord, game: GameId, groupId: string): GroupStats {
  const group = GAMES[game].groups.find((g) => g.id === groupId)!;
  const pulls = rec.pulls.filter((p) => p.group === groupId);
  const hits = topHistory(rec, groupId);
  const counts = hits.map((h) => h.count);
  const average = mean(counts);
  const won = hits.filter((h) => h.pull.featured === true).length;
  const lost = hits.filter((h) => h.pull.featured === false).length;
  const sorted = [...pulls].sort((a, b) => a.time.localeCompare(b.time) || a.indexInSession - b.indexInSession);
  const lastTop = sorted.map((p) => p.top).lastIndexOf(true);
  const since = lastTop >= 0 ? sorted.length - 1 - lastTop : sorted.length + (rec.baseline[groupId]?.pity ?? 0);
  return {
    groupId,
    name: group.name,
    pulls: pulls.length,
    tops: hits.length,
    average,
    best: counts.length ? Math.min(...counts) : null,
    worst: counts.length ? Math.max(...counts) : null,
    since,
    featuredRate: won + lost > 0 ? won / (won + lost) : null,
    featuredWon: won,
    featuredLost: lost,
    pityRatio: average !== null && group.hardPity ? average / group.hardPity : null,
    hits,
    rare: sorted.filter((p) => !p.top && p.rarity === 4 && p.name).reverse(),
  };
}

/** 배너별 기록, 최근 배너부터. */
export function bannerStats(rec: GameRecord): BannerStats[] {
  const map = new Map<string, BannerStats>();
  for (const p of rec.pulls) {
    const key = `${p.group}|${p.banner}`;
    let b = map.get(key);
    if (!b) map.set(key, (b = { banner: p.banner, groupId: p.group, pulls: 0, tops: [], first: p.time, last: p.time }));
    b.pulls++;
    if (p.top) b.tops.push(p);
    if (p.time < b.first) b.first = p.time;
    if (p.time > b.last) b.last = p.time;
  }
  return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
}

export function gameStats(rec: GameRecord, game: GameId): GameStats {
  const def = GAMES[game];
  const groups = def.groups.map((g) => groupStats(rec, game, g.id));
  const counts = groups.flatMap((g) => g.hits.map((h) => h.count));
  // 재화 환산: 각 그룹의 마지막 차감 단계(기본 재화)의 1회 비용으로 계산한다.
  let spent: GameStats["spent"] = null;
  for (const g of def.groups) {
    const base = g.spend[g.spend.length - 1];
    if (!base) continue;
    const n = rec.pulls.filter((p) => p.group === g.id).length;
    const label = def.currencies.find((c) => c.key === base.key)?.label ?? base.key;
    if (!spent) spent = { key: base.key, label, amount: 0 };
    if (spent.key === base.key) spent.amount += (n * base.cost) / base.pulls;
  }
  const times = rec.pulls.map((p) => p.time).sort();
  return {
    game,
    pulls: rec.pulls.length,
    tops: counts.length,
    average: mean(counts),
    spent,
    groups,
    banners: bannerStats(rec),
    firstPull: times[0] ?? null,
    lastPull: times[times.length - 1] ?? null,
  };
}

/** 운 평가 문구: 천장 대비 평균. 기록이 적으면(3개 미만) 판단하지 않는다. */
/** 최고 등급 하나가 n번째 뽑기에서 나올 확률 (n = 1부터). 천장이 없으면 꼬리가 아주 작아질 때까지 */
export function topPmf(odds: NonNullable<PityGroup["odds"]>, hardPity: number | null): number[] {
  const out: number[] = [];
  let survive = 1;
  const limit = hardPity ?? 2000;
  for (let n = 1; n <= limit; n++) {
    let p = odds.base;
    if (odds.softFrom !== null && n >= odds.softFrom) p += odds.step * (n - odds.softFrom + 1);
    if (hardPity !== null && n === hardPity) p = 1;
    p = Math.min(1, p);
    out.push(survive * p);
    survive *= 1 - p;
    if (survive < 1e-9) break;
  }
  return out;
}

/**
 * 운 등급: 같은 수의 최고 등급을 얻은 "평균적인 사람들" 중에서 내 총 뽑기 수가 상위 몇 %인지.
 * 게임 확률로 만든 분포에서 P(총 뽑기 ≤ 나) × 100. 작을수록 운이 좋다. 확률을 모르면 null.
 * (나중에 친구 기록이 모이면 실제 사용자 분포로 바꿀 수 있다 — DESIGN.md §8.5)
 */
export function luckPercentile(game: GameId, groupId: string, counts: number[]): number | null {
  const group = GAMES[game].groups.find((g) => g.id === groupId);
  if (!group?.odds || !counts.length) return null;
  // 묶음 단위(무기 신청 10개)면 확률·천장·기록 모두 묶음 수로 바꿔서 본다
  const unit = group.odds.unit ?? 1;
  const pmf = topPmf(group.odds, group.hardPity === null ? null : Math.round(group.hardPity / unit));
  counts = counts.map((c) => Math.max(1, Math.ceil(c / unit)));
  let dist = [1]; // 합의 분포: dist[s] = P(합 = s)
  for (let k = 0; k < counts.length; k++) {
    const next = new Array(dist.length + pmf.length).fill(0);
    for (let a = 0; a < dist.length; a++) {
      if (!dist[a]) continue;
      for (let b = 0; b < pmf.length; b++) next[a + b + 1] += dist[a] * pmf[b];
    }
    dist = next;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  let cdf = 0;
  for (let s2 = 0; s2 <= Math.min(total, dist.length - 1); s2++) cdf += dist[s2];
  return Math.min(100, Math.max(0, cdf * 100));
}

export function luckLabel(s: GroupStats, game: GameId): string | null {
  const p = luckPercentile(game, s.groupId, s.hits.map((h) => h.count));
  if (p === null) return null;
  return `상위 ${p < 1 ? p.toFixed(1) : Math.round(p)}%`;
}
