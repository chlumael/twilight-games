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
    gauge: "ring",
    vars: {
      ...dark,
      "--bg-rgb": "24, 30, 54",
      "--a1": "#d3bc8e",
      "--a2": "#8fb8e8",
      "--top": "#ffd26e",
      "--glow": "rgba(255, 210, 110, 0.6)",
      "--panel": "rgba(236, 229, 216, 0.06)",
      "--line": "rgba(211, 188, 142, 0.28)",
      "--radius": "12px",
      "--btn-radius": "999px",
      "--btn-bg": "linear-gradient(180deg, #f3ecdf, #dcd2bf)",
      "--btn-fg": "#4a5366",
      "--btn-border": "1px solid #b9a77f",
      "--title-font": "'Cinzel', serif",
      "--num-font": "'Cinzel', serif",
      "--tab-active-bg": "rgba(211, 188, 142, 0.22)",
      "--tab-active-fg": "#f3e3bd",
    },
  },
  arknights: {
    title: "HEADHUNTING",
    sub: "헤드헌팅",
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
    },
  },
  endfield: {
    title: "HEADHUNTING",
    sub: "헤드헌팅",
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
    },
  },
  limbus: {
    title: "EXTRACTION",
    sub: "추출",
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
      "--btn-bg": "linear-gradient(180deg, #a3271d, #6e1711)",
      "--btn-fg": "#f6dfa8",
      "--btn-border": "1px solid #c9a14a",
      "--title-font": "'Cinzel', serif",
      "--num-font": "'Cinzel', serif",
      "--tab-active-bg": "rgba(211, 58, 44, 0.28)",
      "--tab-active-fg": "#f6dfa8",
    },
  },
};

export function skinStyle(game: GameId): string {
  return Object.entries(SKINS[game].vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}
