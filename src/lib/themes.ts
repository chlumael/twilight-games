import type { GameId } from "./types";

/**
 * Per-game skins inspired by each game's gacha screen design language
 * (shapes, colours, typography feel). No game logos, icons, artwork or
 * proprietary fonts are used — only CSS and open fonts.
 */
export interface Skin {
  /** Large English label in the header, like the in-game screen title. */
  title: string;
  /** Small Korean subtitle. */
  sub: string;
  /** Pull button labels, as worded in the game. */
  pull1: string;
  pull10: string;
  /** Pity display: ring (Genshin, Limbus) or segmented bar (Arknights, Endfield). */
  gauge: "ring" | "bar";
  /** CSS custom properties consumed by app.css, skins.css and components. */
  vars: Record<string, string>;
}

const dark = {
  "--text": "#f3eefc",
  "--muted": "rgba(243, 238, 252, 0.6)",
  "--line": "rgba(255, 255, 255, 0.12)",
  "--panel": "rgba(255, 255, 255, 0.05)",
  "--input-bg": "rgba(0, 0, 0, 0.35)",
  "--cell": "rgba(255, 255, 255, 0.16)",
  "--cell-empty": "rgba(255, 255, 255, 0.05)",
  "--track": "rgba(255, 255, 255, 0.09)",
};

export const SKINS: Record<GameId, Skin> = {
  genshin: {
    title: "WISH",
    sub: "기원",
    pull1: "기원 ×1",
    pull10: "기원 ×10",
    gauge: "ring",
    vars: {
      "--bg-rgb": "196, 222, 243",
      "--text": "#3b4255",
      "--muted": "rgba(59, 66, 85, 0.62)",
      "--line": "rgba(59, 66, 85, 0.16)",
      "--panel": "rgba(255, 252, 245, 0.78)",
      "--input-bg": "rgba(255, 255, 255, 0.85)",
      "--cell": "rgba(59, 66, 85, 0.22)",
      "--cell-empty": "rgba(59, 66, 85, 0.07)",
      "--track": "rgba(59, 66, 85, 0.1)",
      "--a1": "#d3bc8e",
      "--a2": "#6e9fd6",
      "--top": "#e9a93a",
      "--glow": "rgba(255, 190, 70, 0.7)",
      "--radius": "10px",
      "--btn-radius": "999px",
      "--btn-bg": "linear-gradient(180deg, #fbf8f1, #ece5d8)",
      "--btn-fg": "#4a5366",
      "--btn-border": "1px solid #d8ccb4",
      "--pill-bg": "rgba(40, 48, 70, 0.55)",
      "--pill-fg": "#ffffff",
      "--pill-muted": "rgba(255, 255, 255, 0.7)",
      "--pill-border": "none",
      "--pill-radius": "999px",
      "--title-font": "'Cinzel', serif",
      "--num-font": "inherit",
      "--tab-active-bg": "#ece5d8",
      "--tab-active-fg": "#4a5366",
    },
  },
  arknights: {
    title: "HEADHUNTING",
    sub: "헤드헌팅",
    pull1: "헤드헌팅 ×1",
    pull10: "헤드헌팅 ×10",
    gauge: "bar",
    vars: {
      ...dark,
      "--bg-rgb": "22, 22, 24",
      "--a1": "#ffffff",
      "--a2": "#f5b70f",
      "--top": "#ff9b2f",
      "--glow": "rgba(255, 155, 47, 0.6)",
      "--line": "rgba(255, 255, 255, 0.16)",
      "--radius": "0px",
      "--btn-radius": "0px",
      "--btn-bg": "#f2f2f2",
      "--btn-fg": "#161616",
      "--btn-border": "none",
      "--btn-clip": "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)",
      "--title-font": "'Barlow Condensed', sans-serif",
      "--num-font": "'Barlow Condensed', sans-serif",
      "--tab-active-bg": "#f2f2f2",
      "--tab-active-fg": "#161616",
      "--pill-bg": "rgba(0, 0, 0, 0.55)",
      "--pill-fg": "#ffffff",
      "--pill-muted": "rgba(255, 255, 255, 0.55)",
      "--pill-border": "1px solid rgba(255, 255, 255, 0.18)",
      "--pill-radius": "0px",
    },
  },
  endfield: {
    title: "HEADHUNTING",
    sub: "헤드헌팅",
    pull1: "헤드헌팅 ×1",
    pull10: "헤드헌팅 ×10",
    gauge: "bar",
    vars: {
      "--bg-rgb": "232, 232, 228",
      "--text": "#1b1b1b",
      "--muted": "rgba(27, 27, 27, 0.58)",
      "--line": "rgba(0, 0, 0, 0.16)",
      "--panel": "rgba(255, 255, 255, 0.65)",
      "--input-bg": "rgba(255, 255, 255, 0.9)",
      "--cell": "rgba(0, 0, 0, 0.18)",
      "--cell-empty": "rgba(0, 0, 0, 0.06)",
      "--track": "rgba(0, 0, 0, 0.1)",
      "--a1": "#1b1b1b",
      "--a2": "#ffd400",
      "--top": "#ff4434",
      "--glow": "rgba(255, 68, 52, 0.55)",
      "--radius": "0px",
      "--btn-radius": "0px",
      "--btn-bg": "#ffd400",
      "--btn-fg": "#111111",
      "--btn-border": "none",
      "--btn-clip": "polygon(0 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%)",
      "--title-font": "'Barlow Condensed', sans-serif",
      "--num-font": "'Barlow Condensed', sans-serif",
      "--tab-active-bg": "#1b1b1b",
      "--tab-active-fg": "#ffd400",
      "--pill-bg": "#1b1b1b",
      "--pill-fg": "#f4f4f4",
      "--pill-muted": "rgba(244, 244, 244, 0.6)",
      "--pill-border": "none",
      "--pill-radius": "0px",
    },
  },
  limbus: {
    title: "EXTRACTION",
    sub: "추출",
    pull1: "1회 추출",
    pull10: "10회 추출",
    gauge: "ring",
    vars: {
      ...dark,
      "--bg-rgb": "18, 12, 12",
      "--text": "#efe4d6",
      "--muted": "rgba(239, 228, 214, 0.58)",
      "--a1": "#d33a2c",
      "--a2": "#c9a14a",
      "--top": "#f2c14e",
      "--glow": "rgba(242, 193, 78, 0.6)",
      "--line": "rgba(201, 161, 74, 0.3)",
      "--panel": "rgba(201, 161, 74, 0.06)",
      "--radius": "2px",
      "--btn-radius": "2px",
      "--btn-bg": "linear-gradient(180deg, #3a2a1e, #1a110c)",
      "--btn-fg": "#f6dfa8",
      "--btn-border": "1px solid #c9a14a",
      "--title-font": "'Cinzel', serif",
      "--num-font": "'Cinzel', serif",
      "--tab-active-bg": "rgba(211, 58, 44, 0.28)",
      "--tab-active-fg": "#f6dfa8",
      "--pill-bg": "linear-gradient(180deg, #2a1d16, #140d0b)",
      "--pill-fg": "#f6dfa8",
      "--pill-muted": "rgba(246, 223, 168, 0.6)",
      "--pill-border": "1px solid #8a6a2c",
      "--pill-radius": "3px",
    },
  },
};

export function skinStyle(game: GameId): string {
  return Object.entries(SKINS[game].vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}
