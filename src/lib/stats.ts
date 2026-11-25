// 통계: 기록에서 계산하는 요약값. 게임 확률을 가정하지 않고 기록과 천장 규칙만 쓴다.
import { GAMES } from "./games";
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
export function luckLabel(s: GroupStats): string | null {
  if (s.pityRatio === null || s.tops < 3) return null;
  if (s.pityRatio <= 0.5) return "운이 아주 좋음";
  if (s.pityRatio <= 0.7) return "운이 좋은 편";
  if (s.pityRatio <= 0.85) return "보통";
  return "천장 근처에서 자주 나옴";
}
