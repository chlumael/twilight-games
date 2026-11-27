import { GAMES, GAME_IDS } from "./games";
import type { GameId } from "./types";
import type { MyEvent } from "./calendar";

export interface Settings {
  schemaVersion: 1;
  /** Background opacity of the overlay, 0.3–1. */
  opacity: number;
  lastGame: GameId;
  /** Group shown on the collapsed line, per game. */
  activeGroup: Record<GameId, string>;
  processNames: Record<GameId, string[]>;
  /** 달력에 내가 넣은 일정 (외부 행사 등) */
  calendar?: MyEvent[];
  /** 지운 내 일정 id (다른 기기와 합칠 때 다시 살아나지 않게) */
  calendarRemoved?: string[];
  /** 내가 하는 게임만 보이게 (사용자 2026-11-26: 게임이 늘어도 위쪽 게임 줄이 넘치지 않게). 넣은 순서 = 보이는 순서(2026-11-27). 없으면 전부 */
  myGames?: GameId[];
  /** 친구 공유 (DESIGN.md §8.5): 켜면 내 요약을 친구 탭(shares/{uid})에 올린다. groups는 예전 그룹 방식의 흔적(쓰지 않음) */
  share?: { on: boolean; nickname: string; groups?: { code: string; name: string }[] };
  /** 화면 테마(배경): "game" = 홈에서 고른 게임을 따라감, 게임 id = 그 게임 테마로 고정(사용자 2026-11-27) */
  theme?: "game" | GameId;
}

export function defaultSettings(): Settings {
  const activeGroup = {} as Record<GameId, string>;
  const processNames = {} as Record<GameId, string[]>;
  for (const id of GAME_IDS) {
    activeGroup[id] = GAMES[id].groups[0].id;
    processNames[id] = [...GAMES[id].processNames];
  }
  return { schemaVersion: 1, opacity: 0.88, lastGame: "genshin", activeGroup, processNames };
}

export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<Settings>;
  const activeGroup = { ...d.activeGroup, ...(r.activeGroup ?? {}) };
  // Drop groups that no longer exist (e.g. removed standard banners).
  for (const id of GAME_IDS) {
    if (!GAMES[id].groups.some((g) => g.id === activeGroup[id])) activeGroup[id] = d.activeGroup[id];
  }
  return {
    ...d,
    ...r,
    activeGroup,
    processNames: { ...d.processNames, ...(r.processNames ?? {}) },
  };
}

/** Choose the game to show from a detection result. */
export function pickDetectedGame(running: GameId[], foreground: GameId | null, current: GameId): GameId {
  if (foreground) return foreground;
  if (running.includes(current)) return current;
  return running[0] ?? current;
}

/** 화면에 보일 게임: 고른 게임(알 수 있는 것만, 순서는 GAME_IDS). 하나도 없으면 전부 */
/** 보여 줄 게임과 순서: 설정의 "내 게임"에 넣은 순서 그대로(사용자 2026-11-27: 사람마다 우선순위가 달라서). 없으면 전부 기본 순서 */
export function shownGames(s: Pick<Settings, "myGames">): GameId[] {
  const picked = [...new Set((s.myGames ?? []).filter((id) => GAME_IDS.includes(id)))];
  return picked.length ? picked : [...GAME_IDS];
}

/** 내 게임에서 i번째를 한 칸 위(-1)·아래(+1)로 옮긴 목록 */
export function moveGame(list: GameId[], i: number, by: -1 | 1): GameId[] {
  const j = i + by;
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
