// 뽑기 감지: 가챠 메인 화면에서 읽은 재화가 줄어들면 "몇 번 뽑았는지"를 계산하고,
// 그 사이 원신 공개 화면에서 본 이름(4·5성, 3성 무기)을 묶어 "확인 대기"로 올린다.
// 기록은 사용자가 확인을 눌러야 들어간다. 순수 함수라 휴대폰 없이 테스트한다.
import type { SpendStep } from "./games";
import type { ScreenFrame, ScreenLine, ScreenReading } from "./recognize";
import type { GameId } from "./types";

export interface ItemInfo {
  rarity: number;
  kind: "character" | "weapon";
}
export type ItemTable = Record<string, ItemInfo>;

export interface SeenItem {
  name: string;
  rarity: number;
  kind: "character" | "weapon";
  time: number;
}

export interface Detection {
  id: string;
  game: GameId;
  time: number;
  /** 재화 차이로 계산한 뽑기 횟수 */
  count: number;
  /** 읽지 못한 재화(티켓 등)를 썼을 수 있어 횟수가 확실하지 않음 */
  uncertain: boolean;
  /** 어떤 재화가 얼마나 줄었는지 (화면 표시용) */
  spent: Record<string, number>;
  /** 그 사이 공개 화면에서 본 것 (원신). 순서는 공개 순서 */
  items: SeenItem[];
  /** 뽑은 뒤 화면에서 읽은 재화 (기록할 때 앱의 재화를 이 값으로 맞춘다) */
  after: Record<string, number>;
}

export interface DetectState {
  /** 게임별로 두 번 연속 같게 읽혀 믿을 수 있는 마지막 재화 (앱을 껐다 켜도 이어지도록 저장한다) */
  stable: Partial<Record<GameId, Record<string, number>>>;
  /** 그 재화를 읽은 시각 */
  stableAt: Partial<Record<GameId, number>>;
  /** 바로 전 프레임에서 읽은 재화 (두 번 연속 같아야 믿는다) */
  candidate: Partial<Record<GameId, Record<string, number>>>;
  /** candidate가 연속으로 같게 읽힌 횟수 */
  repeats?: Partial<Record<GameId, number>>;
  /** 마지막 메인 화면 이후 본 공개 화면 */
  seen: SeenItem[];
  /** 바로 전 프레임의 공개 이름 (같은 화면을 여러 번 세지 않게) */
  lastReveal: string | null;
}

/** 뽑기 전 재화가 이보다 오래된 값이면 "확실하지 않음"으로 표시한다 */
export const STALE_MS = 10 * 60 * 1000;

/** 10배 넘게 뛴 값은 이만큼 연속으로 같게 읽혀야 믿는다 */
export const JUMP_REPEATS = 5;
/** 한 번의 감지로 기록할 수 있는 최대 횟수 (이보다 크면 잘못 읽은 값을 바로잡는 것으로 본다) */
export const MAX_PULLS_AT_ONCE = 100;

export function emptyDetectState(): DetectState {
  return { stable: {}, stableAt: {}, candidate: {}, seen: [], lastReveal: null };
}

const same = (a: Record<string, number> | undefined, b: Record<string, number>) =>
  !!a && Object.keys(b).length > 0 && Object.keys(b).every((k) => a[k] === b[k]) && Object.keys(a).length === Object.keys(b).length;

/**
 * 원신 공개 화면(한 명/한 개씩 보여 주는 화면)에서 이름을 찾는다.
 * 이름은 왼쪽 가운데에 원소·무기 아이콘과 함께 나온다. 아이콘이 글자로 읽혀 앞에 붙는 일이 있어
 * "표에 있는 이름을 포함하고 길이가 거의 같은 줄"을 찾는다.
 */
export function genshinReveal(lines: ScreenLine[], table: ItemTable): { name: string; info: ItemInfo } | null {
  let best: { name: string; info: ItemInfo } | null = null;
  for (const l of lines) {
    if (l.x > 0.45 || l.y < 0.25 || l.y > 0.8) continue;
    const text = l.t.replace(/\s+/g, " ").trim();
    const squashed = text.replace(/\s+/g, "");
    for (const [name, info] of Object.entries(table)) {
      const n = name.replace(/\s+/g, "");
      if (squashed.includes(n) && squashed.length - n.length <= 2 && (!best || n.length > best.name.replace(/\s+/g, "").length)) {
        best = { name, info };
      }
    }
  }
  return best;
}

/**
 * 재화가 줄어든 양으로 뽑기 횟수를 센다. 차감 순서에 있는 재화 중 화면에서 읽은 것만 쓴다.
 * - 줄어든 양이 1회 비용으로 나눠떨어지지 않거나, 읽지 못한 차감 재화가 있으면 uncertain
 */
export function countPulls(
  before: Record<string, number>,
  after: Record<string, number>,
  spend: SpendStep[],
): { count: number; uncertain: boolean; spent: Record<string, number> } {
  let count = 0;
  let uncertain = false;
  const spent: Record<string, number> = {};
  for (const step of spend) {
    if (!(step.key in before) || !(step.key in after)) {
      uncertain = true; // 티켓처럼 화면에 안 나오는 재화를 썼을 수 있다
      continue;
    }
    const d = before[step.key] - after[step.key];
    if (d < 0) {
      // 늘어남: 원신 원석은 창세의 결정을 바꿔 넣었을 수 있다
      if (step.topUp) uncertain = true;
      continue;
    }
    if (d === 0) continue;
    spent[step.key] = d;
    if (d % step.cost !== 0) uncertain = true;
    count += Math.floor(d / step.cost) * step.pulls;
  }
  return { count, uncertain, spent };
}

/**
 * 화면 한 장을 반영한다. 메인 화면 재화가 두 번 연속 같게 읽히면 믿을 수 있는 값으로 삼고,
 * 직전의 믿을 수 있는 값보다 줄었으면 감지 결과를 돌려준다.
 */
export function step(
  state: DetectState,
  frame: ScreenFrame,
  reading: ScreenReading | null,
  ctx: { spendOf: (game: GameId) => SpendStep[]; genshinItems: ItemTable; newId: () => string },
): { state: DetectState; detection: Detection | null } {
  const next: DetectState = {
    stable: { ...state.stable },
    stableAt: { ...state.stableAt },
    candidate: { ...state.candidate },
    repeats: state.repeats,
    seen: state.seen,
    lastReveal: state.lastReveal,
  };

  if (!reading) {
    // 메인 화면이 아니면 원신 공개 화면인지 본다
    const r = genshinReveal(frame.lines, ctx.genshinItems);
    if (r && r.name !== state.lastReveal) {
      next.seen = [...state.seen, { name: r.name, rarity: r.info.rarity, kind: r.info.kind, time: frame.time }].slice(-30);
    }
    next.lastReveal = r?.name ?? null;
    return { state: next, detection: null };
  }

  next.lastReveal = null;
  const { game, currency } = reading;
  if (Object.keys(currency).length === 0) return { state: next, detection: null };
  if (!same(state.candidate[game], currency)) {
    next.candidate[game] = currency;
    next.repeats = { ...state.repeats, [game]: 1 };
    return { state: next, detection: null };
  }
  const repeats = (state.repeats?.[game] ?? 1) + 1;
  next.repeats = { ...state.repeats, [game]: repeats };
  // 직전 값의 10배 이상으로 뛴 재화는 잘못 읽은 것일 가능성이 높다(숫자 옆 무늬가 숫자로 붙어 읽힘).
  // 그런 값은 여러 번(5번) 연속 같게 읽힐 때만 믿는다.
  const prev = state.stable[game];
  if (prev && repeats < JUMP_REPEATS && Object.keys(currency).some((k) => prev[k] !== undefined && currency[k] >= 1000 && currency[k] >= Math.max(prev[k], 1) * 10)) {
    return { state: next, detection: null };
  }
  // 두 번 연속 같게 읽혔다 → 믿을 수 있는 값
  const before = state.stable[game];
  const beforeAt = state.stableAt[game] ?? 0;
  next.stable[game] = currency;
  next.stableAt[game] = frame.time;
  if (!before) {
    next.seen = [];
    return { state: next, detection: null };
  }
  const { count, uncertain, spent } = countPulls(before, currency, ctx.spendOf(game));
  // 한 번에 이렇게 많이 뽑을 수는 없다 → 앞서 잘못 읽은 값을 바로잡는 중이므로 기록하지 않는다
  if (count > MAX_PULLS_AT_ONCE) {
    next.seen = [];
    return { state: next, detection: null };
  }
  if (count <= 0 && !(game === "genshin" && state.seen.length && uncertain)) {
    next.seen = [];
    return { state: next, detection: null };
  }
  const items = game === "genshin" ? state.seen : [];
  next.seen = [];
  // 재화로 셀 수 없었는데(창세의 결정 등) 공개 화면은 봤다면 그 수를 쓴다
  const n = count > 0 ? count : items.length;
  if (n <= 0) return { state: next, detection: null };
  return {
    state: next,
    detection: {
      id: ctx.newId(),
      game,
      time: frame.time,
      count: n,
      // 뽑기 전 재화를 오래전에 읽었으면(가챠 화면을 열자마자 바로 뽑은 경우 등) 그 사이 다른 데 썼을 수 있다
      uncertain: uncertain || (items.length > 0 && items.length !== n) || frame.time - beforeAt > STALE_MS,
      spent,
      items: items.slice(-n),
      after: currency,
    },
  };
}
