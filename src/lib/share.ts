// 친구 공유와 운 순위 (DESIGN.md §8.5). 여기는 순수 계산만: 내 기록 → 친구에게 보일 요약, 요약들 → 순위.
// 올라가는 것: 닉네임, 게임·종류별 뽑기 수·최고 등급 수·평균·픽업 성공·운(상위 %), 최근 최고 등급(이름·몇 뽑·픽업·날짜).
// 안 올라가는 것: 이메일, 재화, 확인 대기 기록, 낮은 등급 결과, 게임 UID.
import { GAMES, GAME_IDS } from "./games";
import { gameStats, luckPercentile } from "./stats";
import type { GameId, Records } from "./types";

export interface ShareGroupSummary {
  groupId: string;
  name: string;
  pulls: number;
  tops: number;
  average: number | null;
  featuredWon: number;
  featuredLost: number;
  /** 운: 같은 수의 최고 등급을 얻은 평균적인 사람들 중 내 위치(%). 작을수록 운이 좋다. 모르면 null */
  luck: number | null;
}

export interface ShareTop {
  name: string | null;
  /** 몇 뽑에 나왔는지 */
  count: number;
  featured: boolean | null;
  /** 날짜(YYYY-MM-DD) — 시각까지는 올리지 않는다 */
  day: string;
  group: string;
}

export interface ShareGame {
  pulls: number;
  tops: number;
  average: number | null;
  luck: number | null;
  groups: ShareGroupSummary[];
  /** 최근 최고 등급 (최신 먼저, 최대 10개) */
  recent: ShareTop[];
}

export interface ShareSummary {
  nickname: string;
  updatedAt: string;
  games: Partial<Record<GameId, ShareGame>>;
  /** 직접 입력 비율(0~1): 친구끼리라 조작은 막지 않고 출처만 보여 준다 */
  manualShare: number;
}

/** 뽑기 수로 가중한 평균 (값이 없는 것은 뺀다) */
function weighted(items: { value: number | null; weight: number }[]): number | null {
  const ok = items.filter((i) => i.value !== null && i.weight > 0);
  const w = ok.reduce((a, i) => a + i.weight, 0);
  return w ? ok.reduce((a, i) => a + (i.value as number) * i.weight, 0) / w : null;
}

/** 내 기록 → 공유 요약. 확인 대기(pending) 뽑기는 빼고 계산한다 */
export function buildSummary(records: Records, nickname: string, games: GameId[] = GAME_IDS, now: Date = new Date()): ShareSummary {
  const out: ShareSummary = { nickname: nickname.trim().slice(0, 20) || "이름 없음", updatedAt: now.toISOString(), games: {}, manualShare: 0 };
  let all = 0;
  let manual = 0;
  for (const g of games) {
    const rec = records.games[g];
    const confirmed = { ...rec, pulls: rec.pulls.filter((p) => p.status !== "pending") };
    if (!confirmed.pulls.length) continue;
    all += confirmed.pulls.length;
    manual += confirmed.pulls.filter((p) => p.source === "manual").length;
    const st = gameStats(confirmed, g);
    const groups: ShareGroupSummary[] = st.groups.filter((x) => x.pulls > 0).map((x) => ({
      groupId: x.groupId, name: x.name, pulls: x.pulls, tops: x.tops, average: x.average,
      featuredWon: x.featuredWon, featuredLost: x.featuredLost,
      luck: luckPercentile(g, x.groupId, x.hits.map((h) => h.count)),
    }));
    const recent: ShareTop[] = st.groups
      .flatMap((x) => x.hits.map((h) => ({ name: h.pull.name, count: h.count, featured: h.pull.featured, day: h.pull.time.slice(0, 10), group: x.name, t: h.pull.time })))
      .sort((a, b) => (a.t < b.t ? 1 : -1))
      .slice(0, 10)
      .map(({ t: _t, ...r }) => r);
    out.games[g] = {
      pulls: st.pulls, tops: st.tops, average: st.average,
      luck: weighted(groups.map((x) => ({ value: x.luck, weight: x.pulls }))),
      groups, recent,
    };
  }
  out.manualShare = all ? manual / all : 0;
  return out;
}

export interface RankRow {
  uid: string;
  nickname: string;
  pulls: number;
  tops: number;
  average: number | null;
  luck: number | null;
  /** 최고 등급이 적어(3개 미만) 운을 믿기 어려움 */
  fewSamples: boolean;
  me: boolean;
}

/**
 * 순위: game을 주면 그 게임만, 없으면 종합(게임별 운을 뽑기 수로 가중 평균).
 * 운(상위 %)이 작을수록 위. 운을 모르는 사람은 아래에 뽑기 수 순으로.
 */
export function ranking(members: { uid: string; summary: ShareSummary }[], me: string, game?: GameId): RankRow[] {
  const rows: RankRow[] = [];
  for (const m of members) {
    const gs = game ? [m.summary.games[game]].filter(Boolean) as ShareGame[] : Object.values(m.summary.games) as ShareGame[];
    if (!gs.length) continue;
    const pulls = gs.reduce((a, x) => a + x.pulls, 0);
    const tops = gs.reduce((a, x) => a + x.tops, 0);
    rows.push({
      uid: m.uid, nickname: m.summary.nickname, pulls, tops,
      average: game ? gs[0].average : null,
      luck: weighted(gs.map((x) => ({ value: x.luck, weight: x.pulls }))),
      fewSamples: tops < 3, me: m.uid === me,
    });
  }
  return rows.sort((a, b) => (a.luck === null ? 1 : 0) - (b.luck === null ? 1 : 0) || (a.luck ?? 0) - (b.luck ?? 0) || b.pulls - a.pulls);
}

/** "상위 3%" / "하위 20%" */
export function luckText(p: number | null): string {
  if (p === null) return "–";
  if (p > 50) return `하위 ${Math.max(1, Math.round(100 - p))}%`;
  return `상위 ${p < 1 ? p.toFixed(1) : Math.round(p)}%`;
}

export interface PoolStats {
  /** 이 게임(또는 전체)을 공유한 사람 수 */
  people: number;
  pulls: number;
  tops: number;
  /** 모두 합친 최고 등급 하나당 평균 뽑기 */
  average: number | null;
  /** 모두 합친 픽업 성공률 (0~1) */
  featuredRate: number | null;
  /** 나보다 운이 좋은 사람 수 + 1 (운을 모르면 null) */
  myRank: number | null;
  /** 운을 아는 사람 수 */
  ranked: number;
}

/** 공유한 사람들 전체의 통계와 내 등수 (game이 없으면 모든 게임 합계) */
export function poolStats(members: { uid: string; summary: ShareSummary }[], me: string, game?: GameId): PoolStats {
  const rows = ranking(members, me, game);
  let pulls = 0, tops = 0, won = 0, lost = 0;
  for (const m of members) {
    const gs = (game ? [m.summary.games[game]] : Object.values(m.summary.games)).filter(Boolean) as ShareGame[];
    for (const x of gs) {
      pulls += x.pulls;
      tops += x.tops;
      for (const g of x.groups) { won += g.featuredWon; lost += g.featuredLost; }
    }
  }
  const ranked = rows.filter((r) => r.luck !== null);
  const mine = ranked.findIndex((r) => r.me);
  return {
    people: rows.length, pulls, tops,
    average: tops ? pulls / tops : null,
    featuredRate: won + lost ? won / (won + lost) : null,
    myRank: mine >= 0 ? mine + 1 : null,
    ranked: ranked.length,
  };
}

/** 게임 이름 (순위 제목용) */
export const gameName = (g: GameId) => GAMES[g].shortName;
