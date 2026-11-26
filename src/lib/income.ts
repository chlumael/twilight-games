// 재화 예측 (DESIGN.md §6-2, 사용자 요청 2026-11-26): 월정액으로 앞으로 받을 재화를 목표일까지 더해 가능 횟수를 계산한다.
// 지급량은 출처를 확인한 것만 넣는다. 출처와 상태(확인됨/추정)는 note에 적는다.
import { availablePulls, groupStatus } from "./ledger";
import { findGroup } from "./games";
import type { GameId, GameRecord } from "./types";

/** 매일 받는 월정액 (남은 일수만큼) */
export interface DailyPass {
  id: string;
  label: string;
  kind: "daily";
  /** 하루에 받는 재화 */
  daily: Record<string, number>;
  /** 한 번 살 때 늘어나는 일수, 최대 일수 */
  days: number;
  maxDays: number | null;
  note: string;
}

export type Pass = DailyPass;

export const PASSES: Record<GameId, Pass[]> = {
  genshin: [
    { id: "welkin", label: "공월 축복", kind: "daily", daily: { primogem: 90 }, days: 30, maxDays: 180,
      note: "매일 원석 90, 30일(최대 180일). 출처: 플레이스테이션 스토어 상품 설명(2026-11-26 확인)" },
  ],
  arknights: [
    { id: "monthly-card", label: "월간 카드", kind: "daily", daily: { orundum: 200 }, days: 30, maxDays: 90,
      note: "매일 합성옥 200, 30일(최대 90일). 출처: 명일방주 위키 Orundum·Packs Store 문서(2026-11-26 확인)" },
  ],
  endfield: [
    { id: "monthly-pass", label: "월정액(Monthly Pass)", kind: "daily", daily: { oroberyl: 200 }, days: 30, maxDays: 180,
      note: "매일 오로베릴 200(접속해서 받아야 함, 못 받은 날은 사라짐), 30일(최대 180일). 출처: 플레이스테이션 스토어·GameWith(2026-11-26 확인)" },
  ],
  limbus: [
    { id: "lunacy-monthly", label: "월간 광기", kind: "daily", daily: { lunacy: 65 }, days: 30, maxDays: null,
      note: "9,900원: 유료 광기 650 + 매일 무료 광기 65, 30일. 출처: 나무위키 Limbus Company/아이템 및 상점(2026-11-26 검색). 영어 위키 Shop 문서는 하루 양을 반대로 적어 차이가 있음 — 가격 대비 합계가 맞는 나무위키 기준" },
    { id: "lunacy-monthly-small", label: "소형 월간 광기", kind: "daily", daily: { lunacy: 39 }, days: 30, maxDays: null,
      note: "4,400원: 유료 광기 130 + 매일 무료 광기 39, 30일. 출처: 나무위키(위와 같음)" },
  ],
};

/** 게임별 예측 설정 (기록과 함께 저장·동기화) */
export interface IncomePlan {
  /** 매일형 월정액: 끝나는 날(YYYY-MM-DD). 없으면 사용 안 함 */
  until: Record<string, string>;
  /** 직접 입력: 하루 평균 무과금 수입(일일 임무 등). 게임이 정한 값이 아니라 사용자가 정한다 */
  extraDaily: Record<string, number>;
  /** 목표일(YYYY-MM-DD). 없으면 지금 배너가 끝나는 날 */
  target: string | null;
}

export const emptyPlan = (): IncomePlan => ({ until: {}, extraDaily: {}, target: null });

const DAY = 864e5;
/** YYYY-MM-DD → 그날 0시(현지) */
export function dayStart(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}
export function today(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}
/** 오늘 다음 날부터 to까지(포함) 며칠 받는지. 오늘 몫은 이미 받았다고 본다 */
export function daysUntil(to: number, from: number): number {
  return Math.max(0, Math.round((to - from) / DAY));
}

export interface ForecastLine {
  label: string;
  gains: Record<string, number>;
  days?: number;
}

/** 목표일까지 받을 재화 */
export function projectIncome(game: GameId, plan: IncomePlan, target: number, now: Date = new Date()): { gains: Record<string, number>; lines: ForecastLine[] } {
  const from = today(now);
  const gains: Record<string, number> = {};
  const lines: ForecastLine[] = [];
  const add = (g: Record<string, number>) => { for (const [k, v] of Object.entries(g)) gains[k] = (gains[k] ?? 0) + v; };
  for (const p of PASSES[game]) {
    const until = plan.until[p.id];
    if (!until) continue;
    const days = daysUntil(Math.min(dayStart(until), target), from);
    if (!days) continue;
    const g = Object.fromEntries(Object.entries(p.daily).map(([k, v]) => [k, v * days]));
    add(g);
    lines.push({ label: p.label, gains: g, days });
  }
  const days = daysUntil(target, from);
  const extra = Object.fromEntries(Object.entries(plan.extraDaily).filter(([, v]) => v > 0).map(([k, v]) => [k, v * days]));
  if (Object.keys(extra).length && days) {
    add(extra);
    lines.push({ label: "직접 입력한 하루 수입", gains: extra, days });
  }
  return { gains, lines };
}

export interface Forecast {
  nowPulls: number;
  laterPulls: number;
  gains: Record<string, number>;
  lines: ForecastLine[];
  /** 최고 등급 확정(천장)까지 필요한 횟수. 천장이 없으면 null */
  toTop: number | null;
  /** 픽업 확정까지 가장 많이 필요한 횟수 (50:50 픽뚫까지 고려). 알 수 없으면 null */
  toFeatured: number | null;
  /** 아직 못 받은 배너 무료 뽑기 (엔드필드: 30회 채우면 10회). 받았거나 없으면 null */
  bonus: { label: string; pulls: number; remaining: number } | null;
}

export function forecast(rec: GameRecord, game: GameId, groupId: string, plan: IncomePlan, target: number, now: Date = new Date()): Forecast {
  const group = findGroup(game, groupId);
  const st = groupStatus(rec, game, groupId);
  const { gains, lines } = projectIncome(game, plan, target, now);
  const later = { ...rec.currency };
  for (const [k, v] of Object.entries(gains)) later[k] = (later[k] ?? 0) + v;
  const toTop = group.hardPity === null ? null : Math.max(0, group.hardPity - st.pity);
  let toFeatured: number | null = null;
  if (group.hardPity !== null) {
    if (group.featuredRule === "fifty-fifty" || group.featuredRule === "fate-point") {
      toFeatured = st.guaranteed ? toTop : toTop! + group.hardPity;
    }
    // 픽업 확정 카운터(엔드필드 120 등): 배너 카운터와 같은 순서
    const idx = group.bannerCounters.findIndex((b) => b.untilFeatured);
    const counter = idx >= 0 ? st.counters[idx] : undefined;
    if (counter && !counter.done) toFeatured = toFeatured === null ? counter.remaining : Math.min(toFeatured, counter.remaining);
  }
  const bonus = group.bonus && st.bannerPulls < group.bonus.at
    ? { label: group.bonus.label, pulls: group.bonus.pulls, remaining: group.bonus.at - st.bannerPulls } : null;
  return {
    bonus,
    nowPulls: availablePulls(rec.currency, group.spend),
    laterPulls: availablePulls(later, group.spend),
    gains, lines, toTop, toFeatured,
  };
}
