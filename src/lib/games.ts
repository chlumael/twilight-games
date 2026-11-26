import type { GameId } from "./types";

/** Spending `cost` of currency `key` yields `pulls` pulls. Steps are tried in order. */
export interface SpendStep {
  key: string;
  cost: number;
  pulls: number;
  /** When `key` runs short, convert from this currency first (원신: 창세의 결정 → 원석). */
  topUp?: { key: string; rate: number };
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
  /**
   * 천장 스택이 다음 배너로 이어지는지. true = 같은 그룹 배너끼리 이어짐, false = 배너마다 새로,
   * "series" = 같은 시리즈 배너끼리만 이어짐(엔드필드 재구축 — 시리즈는 배너 데이터의 series, 모르면 배너마다 새로).
   */
  carryOver: boolean | "series";
  /** How a lost featured roll affects the next top pull. */
  featuredRule: "fifty-fifty" | "fate-point" | "none";
  bannerCounters: BannerCounter[];
  spend: SpendStep[];
  /**
   * 최고 등급 확률(운 등급 계산용, DESIGN.md §6): base = 기본 확률, softFrom번째부터 step씩 오름, 천장에서 확정.
   * 확률을 모르는 그룹은 비워 두고 운 등급을 표시하지 않는다.
   */
  odds?: { base: number; softFrom: number | null; step: number };
  /** 배너에서 처음 at회를 뽑으면 받는 무료 뽑기(재화 안 씀, 천장 스택에 안 들어감) — 엔드필드 긴급 모집 */
  bonus?: { at: number; pulls: number; label: string };
}

export interface CurrencyDef {
  key: string;
  label: string;
  /**
   * 보유량은 사용자가 직접 입력하고, 사용은 자동으로 차감한다.
   * 가챠 화면에 수량이 보이지 않는 재화: 원신 창세의 결정, 명일방주 헤드헌팅권(창고에만 표시), 림버스 추출 티켓.
   */
  manualOnly?: boolean;
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

// 인연 → 원석 → (원석이 모자라면) 창세의 결정을 원석으로 교환.
const genshinEventSpend: SpendStep[] = [
  { key: "intertwined", cost: 1, pulls: 1 },
  { key: "primogem", cost: 160, pulls: 1, topUp: { key: "genesis", rate: 1 } },
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
      { key: "genesis", label: "창세의 결정", manualOnly: true },
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
        odds: { base: 0.006, softFrom: 74, step: 0.06 },
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
        odds: { base: 0.007, softFrom: 63, step: 0.07 },
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
        odds: { base: 0.006, softFrom: 74, step: 0.06 },
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
      { key: "permit", label: "헤드헌팅권", manualOnly: true },
      { key: "tenPermit", label: "10회 헤드헌팅권", manualOnly: true },
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
        odds: { base: 0.02, softFrom: 51, step: 0.02 },
        spend: arknightsSpend,
      },
      {
        id: "arknights-standard",
        name: "일반",
        hardPity: 99,
        softFrom: 51,
        // Unconfirmed (DESIGN.md §6): editable per user later.
        carryOver: false, // 이월 여부 미확정 → 이월 안 되는 것으로 계산(사용자 결정 2026-11-26)
        featuredRule: "none",
        bannerCounters: [],
        odds: { base: 0.02, softFrom: 51, step: 0.02 },
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
        // 사용자 확인(2026-11-26): 한정 배너에서 처음 30회를 뽑으면 무료 10회(재화·스택 반영 없음)
        bonus: { at: 30, pulls: 10, label: "긴급 모집" },
        odds: { base: 0.008, softFrom: 66, step: 0.05 },
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
        carryOver: "series", // 같은 재구축 시리즈끼리만 이월(사용자 확인 2026-11-26)
        featuredRule: "none",
        bannerCounters: [{ at: 120, label: "픽업 확정", untilFeatured: true }],
        spend: [{ key: "oroberyl", cost: 500, pulls: 1 }],
      },
      {
        // 무기 배너(무기고). 10회 단위만, 무기고 증표 1980개. 40회 안에 6성 무기, 80회 안에 픽업 무기 확정.
        // 배너가 바뀌면 이월되지 않는다. 출처: Game8·Mobalytics·Icy Veins 등 공략(2026-11-25 확인, 공식 공지는 미확인)
        id: "endfield-arsenal",
        name: "무기고",
        hardPity: 40,
        softFrom: null,
        carryOver: false,
        featuredRule: "none",
        bannerCounters: [{ at: 80, label: "픽업 무기 확정", untilFeatured: true }],
        spend: [{ key: "arsenalTicket", cost: 1980, pulls: 10 }],
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
      { key: "ticket", label: "추출 티켓", manualOnly: true },
      { key: "tenTicket", label: "10회 추출 티켓", manualOnly: true },
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
        // Tickets are always spent before Lunacy.
        odds: { base: 0.029, softFrom: null, step: 0 },
        spend: [
          { key: "tenTicket", cost: 1, pulls: 10 },
          { key: "ticket", cost: 1, pulls: 1 },
          { key: "lunacy", cost: 130, pulls: 1 },
        ],
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
