// 재화 예측 (DESIGN.md §6-2, 사용자 요청 2026-11-26): 일일·주간 과제 + 켠 월정액으로 목표일까지 모일 재화를 더해 가능 횟수를 계산한다.
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

/**
 * 일일·주간 과제처럼 매번 받는 무과금 수입 (사용자 요청 2026-11-26: 예측 = 일일 과제 + 월정액).
 * weekly는 주간 초기화(resetDay 요일, 0=일요일)마다, monthly는 매달 1일마다 받는다고 본다.
 * 지급량은 출처를 확인한 것만 넣고 출처·상태를 note에 적는다(DESIGN.md §6-2).
 */
export interface Routine {
  id: string;
  label: string;
  daily?: Record<string, number>;
  weekly?: Record<string, number>;
  monthly?: Record<string, number>;
  /** 주간 초기화 요일 (0=일, 1=월 …). 기본 월요일 */
  resetDay?: number;
  note: string;
}

export const ROUTINES: Record<GameId, Routine[]> = {
  genshin: [
    { id: "commissions", label: "일일 의뢰", daily: { primogem: 60 },
      note: "의뢰 4개 10×4 + 캐서린 20 = 원석 60(모험 등급 12부터). 출처: Game8 일본어·영어판 일치(2026-11-26). 스타더스트 교환 인연은 스타더스트가 있어야 해서 넣지 않음" },
  ],
  arknights: [
    { id: "missions", label: "일일·주간 임무", daily: { orundum: 100 }, weekly: { orundum: 500 }, resetDay: 1,
      note: "일일 임무 누적 보상 합성옥 100, 주간 임무 누적 보상 합성옥 500. 출처: 한국 서버 게임 데이터 mission_table.json(2026-11-26)" },
    { id: "annihilation", label: "섬멸 작전(주간 최대)", weekly: { orundum: 1800 }, resetDay: 1,
      note: "주간 합성옥 한도 1200 + 확장 600 = 최대 1800(진행도에 따라 1200~1800). 출처: 한국 서버 게임 데이터 gamedata_const·campaign_table + 일본 공략(2026-11-26). 최대치로 계산하므로 확장을 다 안 열었으면 실제보다 많게 잡힘" },
  ],
  endfield: [
    { id: "daily-weekly", label: "일일·주간 과제", daily: { oroberyl: 200 }, weekly: { oroberyl: 500 }, resetDay: 1,
      note: "일일 활약도 100 → 오로베릴 200, 주간 → 500(월요일 초기화). 출처: GameWith·Altema·AppMedia 일치(2026-11-26)" },
  ],
  limbus: [
    { id: "mirror-weekly", label: "거울 던전 주간 보너스", weekly: { lunacy: 750 }, resetDay: 4,
      note: "일일·주간 임무는 광기를 주지 않음(패스 경험치만). 거울 던전 주간 보너스: 1회 완주 250 × 주 3회 = 광기 750, 목요일 초기화. 출처: 게임 데이터 사본(OpenLethe static-data) + 공략 일치(2026-11-26)" },
  ],
};

/** 게임별 예측 설정 (기록과 함께 저장·동기화) */
export interface IncomePlan {
  /** 월정액 켜기/끄기 (월정액 id → 켬). 켜면 목표일까지 매일 받는다고 본다(게임 안 최대 기간과 상관없이) */
  passes?: Record<string, boolean>;
  /** 일일·주간 과제를 더할지. 없으면 켬 */
  routine?: boolean;
  /** 목표일(YYYY-MM-DD). 없으면 지금 배너가 끝나는 날 */
  target: string | null;
  /** 예전 형식(월정액 끝나는 날). 읽기만 한다: 그날이 오늘 뒤면 켠 것으로 본다 */
  until?: Record<string, string>;
  /** 예전 형식(직접 입력 하루 수입). 더 이상 쓰지 않는다 */
  extraDaily?: Record<string, number>;
}

export const emptyPlan = (): IncomePlan => ({ passes: {}, routine: true, target: null });

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
/** 오늘 다음 날부터 to까지(포함) 그 요일이 몇 번 오는지 */
export function weekdaysUntil(to: number, from: number, weekday: number): number {
  let n = 0;
  for (let t = from + DAY; t <= to + 1; t += DAY) if (new Date(t).getDay() === weekday) n++;
  return n;
}
/** 오늘 다음 날부터 to까지(포함) 1일이 몇 번 오는지 */
export function monthStartsUntil(to: number, from: number): number {
  let n = 0;
  for (let t = from + DAY; t <= to + 1; t += DAY) if (new Date(t).getDate() === 1) n++;
  return n;
}

/** 월정액이 켜져 있는지 (예전 형식이면 끝나는 날이 오늘 뒤인지) */
export function passOn(plan: IncomePlan, id: string, now: Date = new Date()): boolean {
  if (plan.passes && id in plan.passes) return !!plan.passes[id];
  const until = plan.until?.[id];
  return !!until && dayStart(until) > today(now);
}

export interface ForecastLine {
  label: string;
  gains: Record<string, number>;
  /** "10일", "주간 2번" 같은 설명 */
  detail: string;
}

/** 목표일까지 받을 재화: 켠 월정액(매일) + 일일·주간 과제 */
export function projectIncome(game: GameId, plan: IncomePlan, target: number, now: Date = new Date()): { gains: Record<string, number>; lines: ForecastLine[] } {
  const from = today(now);
  const days = daysUntil(target, from);
  const gains: Record<string, number> = {};
  const lines: ForecastLine[] = [];
  const add = (g: Record<string, number>) => { for (const [k, v] of Object.entries(g)) gains[k] = (gains[k] ?? 0) + v; };
  const times = (g: Record<string, number> | undefined, n: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(g ?? {})) if (v * n > 0) out[k] = v * n;
    return out;
  };
  if (!days) return { gains, lines };
  if (plan.routine !== false) {
    for (const r of ROUTINES[game]) {
      const weeks = r.weekly ? weekdaysUntil(target, from, r.resetDay ?? 1) : 0;
      const months = r.monthly ? monthStartsUntil(target, from) : 0;
      const g: Record<string, number> = {};
      for (const part of [times(r.daily, days), times(r.weekly, weeks), times(r.monthly, months)]) {
        for (const [k, v] of Object.entries(part)) g[k] = (g[k] ?? 0) + v;
      }
      if (!Object.keys(g).length) continue;
      add(g);
      const bits = [r.daily ? `${days}일` : "", weeks ? `주간 ${weeks}번` : "", months ? `매달 ${months}번` : ""].filter(Boolean);
      lines.push({ label: r.label, gains: g, detail: bits.join(" · ") });
    }
  }
  for (const p of PASSES[game]) {
    if (!passOn(plan, p.id, now)) continue;
    const g = times(p.daily, days);
    add(g);
    lines.push({ label: p.label, gains: g, detail: `${days}일` });
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
  /** 다음에 받을 배너 누적 보상 (엔드필드: 30회 긴급 모집, 60회 정보서 등). 다 받았거나 없으면 null */
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
    const counter = st.counters.find((c) => c.untilFeatured && !c.next);
    if (counter && !counter.done) toFeatured = toFeatured === null ? counter.remaining : Math.min(toFeatured, counter.remaining);
  }
  const next = (group.bonuses ?? []).find((b) => st.bannerPulls < b.at);
  const bonus = next ? { label: next.label, pulls: next.pulls, remaining: next.at - st.bannerPulls } : null;
  return {
    bonus,
    nowPulls: availablePulls(rec.currency, group.spend),
    laterPulls: availablePulls(later, group.spend),
    gains, lines, toTop, toFeatured,
  };
}
