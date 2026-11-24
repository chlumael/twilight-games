import type { GameId } from "./types";

/**
 * Per-game colour themes. Colours only — no game logos or artwork are used.
 * `a1` is the main accent, `a2` the secondary, `top` the top-rarity colour.
 */
export interface Theme {
  a1: string;
  a2: string;
  top: string;
  glow: string;
  tint: string; // subtle background tint
}

export const THEMES: Record<GameId, Theme> = {
  genshin: { a1: "#e9c77b", a2: "#7fb4ea", top: "#ffcf66", glow: "rgba(255, 207, 102, 0.55)", tint: "rgba(127, 180, 234, 0.10)" },
  arknights: { a1: "#38d2e0", a2: "#f0b43c", top: "#ff9d3c", glow: "rgba(255, 157, 60, 0.55)", tint: "rgba(56, 210, 224, 0.09)" },
  endfield: { a1: "#ffd400", a2: "#9aa3ad", top: "#ff4d3d", glow: "rgba(255, 77, 61, 0.55)", tint: "rgba(255, 212, 0, 0.07)" },
  limbus: { a1: "#e2483c", a2: "#d9a441", top: "#ffcc4d", glow: "rgba(255, 204, 77, 0.55)", tint: "rgba(226, 72, 60, 0.10)" },
};

export function themeStyle(game: GameId): string {
  const t = THEMES[game];
  return `--a1:${t.a1};--a2:${t.a2};--top:${t.top};--glow:${t.glow};--tint:${t.tint}`;
}
