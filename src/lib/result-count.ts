// 결과 화면 세기 (DESIGN.md §4.8 규칙 8): 결과 화면이 2프레임 연속 보이면 한 번 세고,
// 같은 화면이 계속 보이거나 잠깐 가려졌다 다시 보여도(지문이 같으면) 다시 세지 않는다.

export interface ResultState {
  /** 지금 보이는 결과 화면 */
  current: { screen: string; prints: string[]; frames: number; counted: boolean } | null;
  /** 마지막으로 센 결과 화면 */
  last: { screen: string; prints: string[]; at: number } | null;
  /** 결과 화면이 안 보인 연속 프레임 수 */
  gone: number;
}

export const emptyResultState = (): ResultState => ({ current: null, last: null, gone: 0 });

/** 같은 결과 화면으로 보는 시간 (이 안에 지문이 같은 화면이 다시 보이면 세지 않음) */
export const SAME_RESULT_MS = 3 * 60 * 1000;

function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** 칸마다 찍은 지문이 거의 같으면 같은 결과 화면 */
export function samePrints(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((h, i) => hamming(h, b[i]) <= 6);
}

export function stepResult(
  state: ResultState,
  input: { screen: string | null; prints: string[]; time: number },
  minFrames = 2,
): { state: ResultState; count: boolean } {
  if (!input.screen) {
    const gone = state.gone + 1;
    return { state: { ...state, gone, current: gone >= 2 ? null : state.current }, count: false };
  }
  const cur = state.current;
  const current =
    cur && cur.screen === input.screen && samePrints(cur.prints, input.prints)
      ? { ...cur, frames: cur.frames + 1 }
      : { screen: input.screen, prints: input.prints, frames: 1, counted: false };
  const next: ResultState = { ...state, current, gone: 0 };
  if (current.counted || current.frames < minFrames) return { state: next, count: false };
  current.counted = true;
  const last = state.last;
  if (last && last.screen === input.screen && samePrints(last.prints, input.prints) && input.time - last.at < SAME_RESULT_MS) {
    return { state: next, count: false }; // 이미 센 화면이 다시 보인 것
  }
  next.last = { screen: input.screen, prints: input.prints, at: input.time };
  return { state: next, count: true };
}
