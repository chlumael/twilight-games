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
  /** 이상이 줄었음 = 200개로 교환함(그 사이 뽑은 것은 add에 들어 있다) */
  exchanged: boolean;
}

/** 이상 값 한 번 읽음 → 두 번 연속 같으면 확정, 오른 만큼 뽑기. 줄었으면 200 교환 + 그 사이 뽑기 */
export function counterStep(state: CounterState, banner: string | null, value: number | null): CounterStep {
  const none = { add: 0, first: null, from: null, exchanged: false };
  if (!banner || value === null) return { state: { ...state, pending: null }, ...none };
  if (!state.pending || state.pending.banner !== banner || state.pending.value !== value) {
    return { state: { ...state, pending: { banner, value } }, ...none };
  }
  const before = state.last[banner];
  const next: CounterState = { pending: state.pending, last: { ...state.last, [banner]: value } };
  if (before === undefined) return { state: next, add: 0, first: value, from: null, exchanged: false };
  if (value >= before) return { state: next, add: value - before, first: null, from: before, exchanged: false };
  // 줄었으면 200개 교환(사용자 지적 2026-11-27): 그 사이 뽑은 것 = 지금 + 200 − 직전 (예: 190 → 10뽑 → 200 → 교환 → 0 = 10회)
  return { state: next, add: value + 200 - before, first: null, from: before, exchanged: true };
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

/** 추출 확인 창: 무엇을 얼마나 써서 어느 배너를 뽑는지 */
export interface LimbusConfirm {
  /** 이번에 뽑는 횟수 */
  pulls: number;
  /** "광기" / "추출 티켓" 등 */
  item: string;
  amount: number;
  /** 창에 적힌 배너 이름 부분(예: "히스클리프") */
  target: string;
}

/**
 * 추출 확인 창 읽기 (실제 화면 문구, 2026-11-27): "광기 1300을(를) 소비하여 특정 추출 / 히스클리프을(를) 진행합니다."
 * 결과 화면의 "재추출"에서도 같은 창이 뜬다 → 연속 뽑기도 매번 센다.
 * 광기 1300 = 10회, 130(할인 13) = 1회. 티켓은 장수만큼(10회 추출 티켓은 장당 10회).
 * 화면 글자가 조금 틀려도("을(롤)", 띄어쓰기) 알아보게 넉넉하게 맞춘다. 휴대폰 실기: fixtures/limbus-confirm-phone.txt
 */
export function parseLimbusConfirm(lines: { t: string; x: number; y: number }[]): LimbusConfirm | null {
  const text = [...lines].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.t).join(" ").replace(/\s+/g, " ");
  // 무엇을 얼마나: "광기 1300", "추출 10회 티켓 1"(휴대폰 실기 어순, 2026-11-27), "추출 티켓 1"
  // 어느 배너: "소비하여" 뒤 ~ "을(를) 진행" 앞. 신규 배너는 "신규 인격 특정 추출 (인격 둘)"처럼 세 줄로 길다
  const m = text.match(/(광기|(?:추출\s*)?(?:10회\s*)?(?:추출\s*)?티켓)\s*(\d{1,5})\s*을.{0,4}?소비\s*하여(.{1,200}?)을.{0,4}?진행/);
  if (!m) return null;
  const item = m[1].replace(/\s+/g, " ").trim();
  const amount = Number(m[2]);
  if (!amount) return null;
  const pulls = item === "광기" ? Math.max(1, Math.round(amount / 130)) : /10회/.test(item) ? amount * 10 : amount;
  if (pulls > 10) return null; // 한 번에 10회까지
  const target = (m[3].split(/(?:특정|일반)\s*추출/).pop() ?? m[3]).trim();
  return { pulls, item, amount, target };
}
