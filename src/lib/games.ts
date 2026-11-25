import type { GameId } from "./types";

/** Spending `cost` of currency `key` yields `pulls` pulls. Steps are tried in order. */
export interface SpendStep {
  key: string;
  cost: number;
  pulls: number;
}

export interface BannerCounter {
  at: number;
  label: string;
  /** Counter stops mattering once the featured item was obtained on this banner. */
  untilFeatured?: boolean;
  /** Repeats every `at` pulls (e.g. Endfield 240 token). */
  repeat?: boolean;
}

export interface PityGroup {
  id: string;
  name: string;
  /** Hard pity for top rarity; null when the game has none (Limbus). */
  hardPity: number | null;
  /** First pull number with increased rate (shown as a hint only). */
  softFrom: number | null;
  /** Pity counter carries over to the next banner of the same group. */
  carryOver: boolean;
  /** How a lost featured roll affects the next top pull. */
  featuredRule: "fifty-fifty" | "fate-point" | "none";
  bannerCounters: BannerCounter[];
  spend: SpendStep[];
}

export interface CurrencyDef {
  key: string;
  label: string;
}

export interface GameDef {
  id: GameId;
  name: string;
  shortName: string;
  topLabel: string; // "5성", "6성", "000"
  currencies: CurrencyDef[];
  groups: PityGroup[];
  /** Default executable names for auto-detection (editable in settings). */
  processNames: string[];
}

const genshinEventSpend: SpendStep[] = [
  { key: "intertwined", cost: 1, pulls: 1 },
  { key: "primogem", cost: 160, pulls: 1 },
];

const arknightsSpend: SpendStep[] = [
  { key: "tenPermit", cost: 1, pulls: 10 },
  { key: "permit", cost: 1, pulls: 1 },
  { key: "orundum", cost: 600, pulls: 1 },
];

export const GAMES: Record<GameId, GameDef> = {
  genshin: {
    id: "genshin",
    name: "원신",
    shortName: "원신",
    topLabel: "5성",
    currencies: [
      { key: "primogem", label: "원석" },
      { key: "intertwined", label: "뒤엉킨 인연" },
    ],
    groups: [
      {
        id: "genshin-char",
        name: "캐릭터",
        hardPity: 90,
        softFrom: 74,
        carryOver: true,
        featuredRule: "fifty-fifty",
        bannerCounters: [],
        spend: genshinEventSpend,
      },
      {
        id: "genshin-weapon",
        name: "무기",
        hardPity: 80,
        softFrom: 63,
        carryOver: true,
        featuredRule: "fate-point",
        bannerCounters: [],
        spend: genshinEventSpend,
      },
      {
        id: "genshin-chronicled",
        name: "집록",
        hardPity: 90,
        softFrom: 74,
        carryOver: true,
        featuredRule: "fate-point",
        bannerCounters: [],
        spend: genshinEventSpend,
      },
    ],
    processNames: ["GenshinImpact.exe", "YuanShen.exe"],
  },
  arknights: {
    id: "arknights",
    name: "명일방주",
    shortName: "명방",
    topLabel: "6성",
    currencies: [
      { key: "orundum", label: "합성옥" },
      { key: "originite", label: "오리지늄" },
      { key: "permit", label: "헤드헌팅권" },
      { key: "tenPermit", label: "10회 헤드헌팅권" },
    ],
    groups: [
      {
        id: "arknights-limited",
        name: "한정",
        hardPity: 99,
        softFrom: 51,
        carryOver: false,
        featuredRule: "none",
        bannerCounters: [{ at: 300, label: "선택 영입" }],
        spend: arknightsSpend,
      },
      {
        id: "arknights-standard",
        name: "일반",
        hardPity: 99,
        softFrom: 51,
        // Unconfirmed (DESIGN.md §6): editable per user later.
        carryOver: true,
        featuredRule: "none",
        bannerCounters: [],
        spend: arknightsSpend,
      },
    ],
    // Unconfirmed: the PC client's executable name must be verified.
    processNames: ["Arknights.exe"],
  },
  endfield: {
    id: "endfield",
    name: "명일방주: 엔드필드",
    shortName: "엔드필드",
    topLabel: "6성",
    currencies: [
      { key: "oroberyl", label: "오로베릴" },
      { key: "origeometry", label: "파생 오리지늄" },
      { key: "charteredPermit", label: "한정 헤드헌팅 허가증" },
      { key: "limitedPermit", label: "기간 한정 허가증" },
      { key: "arsenalTicket", label: "무기고 증표" },
    ],
    groups: [
      {
        id: "endfield-chartered",
        name: "한정",
        hardPity: 80,
        softFrom: 66,
        carryOver: true,
        featuredRule: "none",
        bannerCounters: [
          { at: 120, label: "픽업 확정", untilFeatured: true },
          { at: 240, label: "픽업 토큰", repeat: true },
        ],
        spend: [
          { key: "limitedPermit", cost: 1, pulls: 1 },
          { key: "charteredPermit", cost: 1, pulls: 1 },
          { key: "oroberyl", cost: 500, pulls: 1 },
        ],
      },
      {
        id: "endfield-refactor",
        name: "RE-Factor",
        hardPity: 80,
        softFrom: 66,
        carryOver: true,
        featuredRule: "none",
        bannerCounters: [{ at: 120, label: "픽업 확정", untilFeatured: true }],
        spend: [{ key: "oroberyl", cost: 500, pulls: 1 }],
      },
    ],
    // Unconfirmed: verify on a real install.
    processNames: ["Endfield.exe"],
  },
  limbus: {
    id: "limbus",
    name: "림버스 컴퍼니",
    shortName: "림버스",
    topLabel: "000",
    currencies: [
      { key: "lunacy", label: "광기" },
      { key: "ticket", label: "추출 티켓" },
      { key: "tenTicket", label: "10회 추출 티켓" },
    ],
    groups: [
      {
        id: "limbus-extraction",
        name: "픽업 추출",
        hardPity: null,
        softFrom: null,
        carryOver: false,
        featuredRule: "none",
        bannerCounters: [{ at: 200, label: "교환" }],
        spend: [{ key: "lunacy", cost: 130, pulls: 1 }],
      },
    ],
    processNames: ["LimbusCompany.exe"],
  },
};

export const GAME_IDS = Object.keys(GAMES) as GameId[];

export function findGroup(game: GameId, groupId: string): PityGroup {
  const g = GAMES[game].groups.find((x) => x.id === groupId);
  if (!g) throw new Error(`unknown pity group ${groupId}`);
  return g;
}
