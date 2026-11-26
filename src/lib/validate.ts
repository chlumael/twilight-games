// 읽은 값 검증 (DESIGN.md §4.8 규칙 6).
// 범위 검사는 screen-profile.ts의 parseField에서 끝난 값만 들어온다. 여기서는
// ① 같은 값이 정해진 횟수만큼 연속으로 읽혀야 인정하고, ② 직전 인정값과 안 맞으면(뽑은 수만큼 안 바뀜) "의심"으로 보고 3번을 요구한다.
import type { FieldUse } from "./screen-profile";

export interface FieldTrack {
  /** 마지막으로 인정한 값 */
  confirmed: number | string | null;
  confirmedAt: number;
  /** 지금 연속으로 읽히는 값과 횟수 */
  candidate: number | string | null;
  streak: number;
  /** 인정한 뒤 결과 화면으로 센 뽑기 수 (직전 값과 맞는지 볼 때 씀) */
  pullsSince: number;
}
export type TrackState = Record<string, FieldTrack>;

const empty = (): FieldTrack => ({ confirmed: null, confirmedAt: 0, candidate: null, streak: 0, pullsSince: 0 });

/** 직전 인정값에서 새 값으로 바뀐 것이 말이 되는지. null = 따지지 않음 */
export function expected(use: FieldUse, prev: number, next: number, pulls: number): boolean | null {
  switch (use.type) {
    case "toTop":
      // 뽑은 만큼 줄거나, 최고 등급이 나와 다시 커졌거나
      return next === prev - pulls || next > prev - pulls;
    case "toFeatured":
      // 픽업 확정까지는 뽑은 만큼만 준다(최초 1회 — 다시 커지지 않음)
      return next === prev - pulls;
    case "bannerPulls":
      return next === prev + pulls;
    default:
      return null; // 재화는 수입이 있어 따지지 않는다
  }
}

export interface Observed {
  state: TrackState;
  /** 이번에 새로 인정된 값 (없으면 null) */
  accepted: number | string | null;
  /** 직전 값과 안 맞아 더 확인 중 */
  suspect: boolean;
}

/** 값 하나를 관찰한다. confirm = 필요한 연속 횟수(2~3) */
export function observe(state: TrackState, key: string, value: number | string, use: FieldUse, confirm: number, now: number): Observed {
  const cur = state[key] ?? empty();
  const streak = cur.candidate === value ? cur.streak + 1 : 1;
  let suspect = false;
  if (cur.confirmed !== null && typeof cur.confirmed === "number" && typeof value === "number" && value !== cur.confirmed) {
    suspect = expected(use, cur.confirmed, value, cur.pullsSince) === false;
  }
  const need = suspect ? Math.max(confirm, 3) : confirm;
  const next: FieldTrack = { ...cur, candidate: value, streak };
  let accepted: number | string | null = null;
  if (streak >= need && value !== cur.confirmed) {
    next.confirmed = value;
    next.confirmedAt = now;
    next.pullsSince = 0;
    accepted = value;
  }
  return { state: { ...state, [key]: next }, accepted, suspect: suspect && accepted === null };
}

/** 결과 화면으로 뽑기를 셌을 때: 그 게임의 칸들이 "뽑은 뒤"를 기대하도록 */
export function addPulls(state: TrackState, game: string, n: number): TrackState {
  const out: TrackState = {};
  for (const [k, v] of Object.entries(state)) out[k] = k.startsWith(`${game}:`) ? { ...v, pullsSince: v.pullsSince + n } : v;
  return out;
}

export const confirmedValue = (state: TrackState, key: string) => state[key]?.confirmed ?? null;
