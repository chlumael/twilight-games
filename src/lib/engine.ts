// 새 화면 인식 엔진 (DESIGN.md §4.8). PC가 정해진 위치만 잘라 읽어 보낸 결과(RegionFrame)를
// 화면 틀로 해석 → 값 검증 → 앱에 반영할 일(EngineAction)로 바꾼다. 순수 함수라 게임 없이 테스트한다.
import { findScreen, parseField, PROFILES, type FieldResult, type GameProfile } from "./screen-profile";
import { emptyResultState, stepResult, type ResultState } from "./result-count";
import { addPulls, confirmedValue, observe, type TrackState } from "./validate";
import type { GameId } from "./types";

/** PC(src-tauri/src/regions.rs)가 보내는 한 프레임 */
export interface RegionFrame {
  time: number;
  width: number;
  height: number;
  /** 판단된 화면 id (없으면 null) */
  screen: string | null;
  /** 칸 id → 잘라 읽은 글자 */
  fields: Record<string, string>;
  /** 결과 화면: 칸마다 최고 등급 표시가 맞았는지 */
  tops: boolean[];
  /** 결과 화면: 칸마다 찍은 지문 (같은 화면 두 번 세기 방지) */
  prints: string[];
}

export type EngineAction =
  | { type: "currency"; game: GameId; values: Record<string, number> }
  | { type: "pity"; game: GameId; group: string; toTop: number | null; toFeatured: number | null }
  | { type: "bannerPulls"; game: GameId; group: string; value: number }
  | { type: "result"; game: GameId; group: string | null; count: number; tops: number[] }
  | { type: "signal"; game: GameId; screen: string };

export interface EngineStatus {
  kind: "idle" | "ok" | "suspect" | "fail";
  message: string;
  screen: string | null;
  at: number;
}

export interface EngineState {
  track: TrackState;
  result: ResultState;
  signal: ResultState;
  /** 칸을 못 읽은 연속 프레임 수 */
  failStreak: number;
  status: EngineStatus;
}

export const emptyEngineState = (): EngineState => ({
  track: {},
  result: emptyResultState(),
  signal: emptyResultState(),
  failStreak: 0,
  status: { kind: "idle", message: "", screen: null, at: 0 },
});

/** 실패를 표시하기까지 연속 프레임 수 (한 번 흔들린 것으로는 표시하지 않음) */
const FAIL_FRAMES = 2;

export function engineStep(state: EngineState, frame: RegionFrame, profiles: GameProfile[] = PROFILES): { state: EngineState; actions: EngineAction[] } {
  const found = frame.screen ? findScreen(frame.screen, profiles) : null;
  const actions: EngineAction[] = [];
  if (!found) {
    const r = stepResult(state.result, { screen: null, prints: [], time: frame.time });
    const s = stepResult(state.signal, { screen: null, prints: [], time: frame.time });
    return { state: { ...state, result: r.state, signal: s.state, failStreak: 0 }, actions };
  }
  const { profile, screen } = found;
  const game = profile.game;
  let next: EngineState = { ...state };

  // 결과 화면: 횟수 세기
  if (screen.kind === "result") {
    const r = stepResult(state.result, { screen: screen.id, prints: frame.prints, time: frame.time });
    next.result = r.state;
    if (r.count) {
      const pulls = screen.pulls ?? 0;
      const tops = frame.tops.map((t, i) => (t ? i : -1)).filter((i) => i >= 0 && i < pulls);
      actions.push({ type: "result", game, group: screen.group, count: pulls, tops });
      next.track = addPulls(next.track, game, pulls);
    }
    next.status = { kind: "ok", message: `결과 화면 (${screen.pulls}회)`, screen: screen.id, at: frame.time };
    return { state: next, actions };
  }
  if (screen.kind === "signal") {
    const s = stepResult(state.signal, { screen: screen.id, prints: frame.prints, time: frame.time });
    next.signal = s.state;
    if (s.count) actions.push({ type: "signal", game, screen: screen.id });
    return { state: next, actions };
  }
  if (screen.kind !== "main") return { state: next, actions }; // 기록 화면·세지 않을 화면

  // 뽑기 화면: 칸 해석 → 검증
  const results: FieldResult[] = screen.fields.map((f) => parseField(f, frame.fields[f.id], profile.fixes));
  const failed = results.filter((r) => !r.ok && r.reason !== "빈칸");
  const suspects: string[] = [];
  const currency: Record<string, number> = {};
  let pityChanged = false;
  for (const r of results) {
    if (!r.ok) continue;
    const field = screen.fields.find((f) => f.id === r.id)!;
    const key = `${game}:${screen.group}:${r.id}`;
    const o = observe(next.track, key, r.value, r.use, field.confirm, frame.time);
    next.track = o.state;
    if (o.suspect) suspects.push(r.id);
    if (o.accepted === null) continue;
    if (r.use.type === "currency" && typeof o.accepted === "number") currency[r.use.key] = o.accepted;
    else if (r.use.type === "toTop" || r.use.type === "toFeatured") pityChanged = true;
    else if (r.use.type === "bannerPulls" && typeof o.accepted === "number" && screen.group) {
      actions.push({ type: "bannerPulls", game, group: screen.group, value: o.accepted });
    }
  }
  if (Object.keys(currency).length) actions.push({ type: "currency", game, values: currency });
  if (pityChanged && screen.group) {
    const val = (id: string) => {
      const v = confirmedValue(next.track, `${game}:${screen.group}:${id}`);
      return typeof v === "number" ? v : null;
    };
    actions.push({ type: "pity", game, group: screen.group, toTop: val("toTop"), toFeatured: val("toFeatured") });
  }

  next.failStreak = failed.length ? state.failStreak + 1 : 0;
  if (failed.length && next.failStreak >= FAIL_FRAMES) {
    const what = failed.map((f) => `${f.id}(${f.ok ? "" : f.reason})`).join(", ");
    next.status = { kind: "fail", message: `인식 못 함: ${what}`, screen: screen.id, at: frame.time };
  } else if (suspects.length) {
    next.status = { kind: "suspect", message: `확인 중(직전 값과 안 맞음): ${suspects.join(", ")}`, screen: screen.id, at: frame.time };
  } else if (!failed.length) {
    next.status = { kind: "ok", message: "", screen: screen.id, at: frame.time };
  }
  return { state: next, actions };
}
