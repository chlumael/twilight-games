import { GAMES, GAME_IDS } from "./games";
import type { GameId } from "./types";

export interface Settings {
  schemaVersion: 1;
  /** Background opacity of the overlay, 0.3–1. */
  opacity: number;
  lastGame: GameId;
  /** Group shown on the collapsed line, per game. */
  activeGroup: Record<GameId, string>;
  processNames: Record<GameId, string[]>;
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
  return {
    ...d,
    ...r,
    activeGroup: { ...d.activeGroup, ...(r.activeGroup ?? {}) },
    processNames: { ...d.processNames, ...(r.processNames ?? {}) },
  };
}

/** Choose the game to show from a detection result. */
export function pickDetectedGame(running: GameId[], foreground: GameId | null, current: GameId): GameId {
  if (foreground) return foreground;
  if (running.includes(current)) return current;
  return running[0] ?? current;
}
