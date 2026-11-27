// 림버스 뽑기 세기: 추출 화면의 "이상 N/200"이 오른 만큼 (사용자 2026-11-27).
// 광기 감소로 세던 방식은 티켓 뽑기를 못 세고 다른 배너와 섞였다. 이상은 그 배너에서 뽑을 때마다 1씩 오르므로
// 광기·티켓 어느 쪽이든 세고, 다른 배너 뽑기와 섞이지 않는다.
// 결과 화면에서 연달아 뽑고 나중에 한 번만 메인으로 나와도, 마지막으로 본 값과의 차이로 한꺼번에 센다.
import type { PackBanner } from "./banners";
import type { ScreenReading } from "./recognize";

export interface CounterState {
  /** 한 번 읽은 값(두 번 연속 같아야 확정) */
  pending: { banner: string; value: number } | null;
  /** 배너 id → 마지막으로 확정한 이상 값 */
  last: Record<string, number>;
}

export const emptyCounterState = (): CounterState => ({ pending: null, last: {} });

export interface CounterStep {
  state: CounterState;
  /** 새로 센 뽑기 수 */
  add: number;
  /** 이 배너의 이상 값을 처음 확정했을 때 그 값(앱 누적 횟수를 맞추는 데 쓴다) */
  first: number | null;
  /** 직전 값 → 지금 값 (알림용) */
  from: number | null;
}

/** 이상 값 한 번 읽음 → 두 번 연속 같으면 확정, 오른 만큼 뽑기. 줄었으면(200 교환) 기준만 바꾼다 */
export function counterStep(state: CounterState, banner: string | null, value: number | null): CounterStep {
  const none = { add: 0, first: null, from: null };
  if (!banner || value === null) return { state: { ...state, pending: null }, ...none };
  if (!state.pending || state.pending.banner !== banner || state.pending.value !== value) {
    return { state: { ...state, pending: { banner, value } }, ...none };
  }
  const before = state.last[banner];
  const next: CounterState = { pending: state.pending, last: { ...state.last, [banner]: value } };
  if (before === undefined) return { state: next, add: 0, first: value, from: null };
  return { state: next, add: Math.max(0, value - before), first: null, from: before };
}

/** "2026.12.10 10:00 [KST] 까지" → "2026-12-10" */
function untilDay(until: string | null): string | null {
  const m = until?.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 한국 시간 날짜 */
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 36e5).toISOString().slice(0, 10);

/**
 * 화면의 추출이 어느 배너인지: 화면의 종료일(한국 시간)이 같고, 오른쪽 큰 수감자 이름이 읽혔으면 그 배너 픽업 중 하나와 같은 배너.
 * 하나로 정해지지 않으면 null(세지 않는다 — 다른 배너 뽑기가 섞이지 않게).
 */
export function limbusBannerOnScreen(reading: Pick<ScreenReading, "until" | "sinner">, banners: PackBanner[]): PackBanner | null {
  const day = untilDay(reading.until);
  if (!day) return null;
  const hit = banners.filter((b) => b.end && kstDay(b.end) === day
    && (!reading.sinner || b.featured.some((f) => (f.ko ?? "").endsWith(` ${reading.sinner}`))));
  return hit.length === 1 ? hit[0] : null;
}
