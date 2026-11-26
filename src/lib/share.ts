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

/** 초대 코드: 헷갈리는 글자(0/O, 1/I/L)를 뺀 10자리 */
export function newGroupCode(random: () => number = Math.random): string {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += abc[Math.floor(random() * abc.length)];
  return s;
}

export function validCode(code: string): boolean {
  return /^[A-HJ-NP-Z2-9]{10}$/.test(code.trim().toUpperCase());
}

/** 게임 이름 (순위 제목용) */
export const gameName = (g: GameId) => GAMES[g].shortName;
