import type { GameId } from "./types";

/** Spending `cost` of currency `key` yields `pulls` pulls. Steps are tried in order. */
export interface SpendStep {
  key: string;
  cost: number;
  pulls: number;
  /** When `key` runs short, convert from this currency first (원신: 창세의 결정 → 원석, 엔드필드: 파생 오리지늄 → 오로베릴 ×75, 명일방주: 오리지늄 → 합성옥 ×180). */
  topUp?: { key: string; rate: number };
}

export interface BannerCounter {
  at: number;
  label: string;
  /** Counter stops mattering once the featured item was obtained on this banner. */
  untilFeatured?: boolean;
  /** Repeats every `at` pulls (e.g. Endfield 240 token). */
  repeat?: boolean;
  /** 뽑은 횟수만큼 쌓이는 교환 재화로 최고 등급을 교환하는 카운터(명일방주 헤드헌팅 데이터 계약 300, 림버스 이상 200). 교환하면 at만큼 줄어든다 */
  exchange?: boolean;
  /** 배너 id에 이 글자가 들어 있는 배너에만 적용 (명일방주: 풀 종류 ":SINGLE_", ":DOUBLE_") */
  bannerMatch?: string;
  /** at회째에 확정이 아니라, at회가 지난 뒤 "다음에 나오는 최고 등급"이 픽업으로 확정 (명일방주 지향·표준 셀렉션) */
  next?: boolean;
  /** 픽업을 얻을 때마다 처음부터 다시 센다 (명일방주 새 콜라보: 120회마다 확정) */
  sinceFeatured?: boolean;
}

/** 이 배너에 적용되는 카운터만 */
export function countersOf(group: PityGroup, bannerId: string): BannerCounter[] {
  return group.bannerCounters.filter((c) => !c.bannerMatch || bannerId.includes(c.bannerMatch));
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
   * unit = 한 번에 뽑는 묶음(엔드필드 무기 신청 10개) — 확률과 천장을 묶음 단위로 본다.
   * 확률을 모르는 그룹은 비워 두고 운 등급을 표시하지 않는다.
   */
  odds?: { base: number; softFrom: number | null; step: number; unit?: number };
  /** 뽑을 때마다 함께 받는 재화: 최고 등급이면 top개, 아니면 other개 (엔드필드: 오퍼레이터를 얻을 때마다 무기고 징표) */
  gain?: { key: string; top: number; other: number };
  /** 배너 누적 at회에 받는 무료 뽑기(재화 안 씀, 천장 스택에 안 들어감) — 엔드필드 긴급 모집 등. 각각 1회 */
  bonuses?: { at: number; pulls: number; label: string; nextBanner?: string }[];
  // nextBanner = 무료 뽑기가 아니라, 같은 종류의 다음 배너가 열릴 때 이 재화 pulls개로 받는 보상(엔드필드 헤드헌팅 정보서)
  /**
   * 픽업 최고 등급이 이 종류의 "나올 수 있는 목록"에 남는 배너 수(그 배너 포함). 엔드필드 특별 허가 = 3:
   * 픽업 배너 + 다음 두 배너에서는 픽뚫로 나오고, 그 뒤에는 목록에서 빠진다(상시에도 안 들어감). 재구축 = 1.
   */
  rotation?: { stays: number };
  /**
   * 원신 「별빛 포착」: "픽뚫 → 다음에 확정으로 픽업"이 이 횟수만큼 이어지면, 그다음 최고 등급은 50:50이 아니라 픽업 확정.
   * (공식 기원 상세: "3회 연속으로 두 번째에 확률 UP ★5 캐릭터를 획득한 경우 … 확정적으로 별빛 포착이 발동")
   */
  lossStreakGuarantee?: number;
  /** 최고 등급 중 픽업이 나올 확률(확정이 아닐 때). 없으면 0.5로 보고 "50:50"이라고 쓴다. 원신 무기 = 0.75(공식) */
  featuredShare?: number;
  /** 이 종류는 배너에 적힌 것만 나온다(원신 묶음 기원). 이름 후보에 다른 이름을 섞지 않는다 */
  onlyListed?: boolean;
  /** 긴급 모집처럼 무료 뽑기에서 나온 최고 등급을 따로 적을 때 쓰는 이름. 천장·누적 횟수에 안 들어간다 */
  freeLabel?: string;
  /** 배너 카운터(픽업 확정·누적 보상)를 세는 범위. "series" = 같은 시리즈 배너끼리 이어서 셈(엔드필드 재구축) */
  counterScope?: "series";
}

export interface CurrencyDef {
  key: string;
  label: string;
  /**
   * 보유량은 사용자가 직접 입력하고, 사용은 자동으로 차감한다.
   * 가챠 화면에 수량이 보이지 않는 재화: 원신 창세의 결정, 명일방주 헤드헌팅권(창고에만 표시), 림버스 추출 티켓.
   */
  manualOnly?: boolean;
  /** 이 종류(그룹 id)의 배너가 끝나면 사라지는 재화 (엔드필드 배너 전용 헤드헌팅 허가증) */
  expiresWith?: string;
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
  { key: "orundum", cost: 600, pulls: 1, topUp: { key: "originite", rate: 180 } }, // 오리지늄 1개 = 합성옥 180
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
        lossStreakGuarantee: 3,
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
        featuredShare: 0.75,
        bannerCounters: [],
        odds: { base: 0.007, softFrom: 63, step: 0.07 },
        spend: genshinEventSpend,
      },
      {
        // 공식 한국어 이름은 「묶음 기원」(고르는 것은 「묶음 궤도」). 기원 횟수는 묶음 기원·복각 기원이 함께 센다(공식)
        id: "genshin-chronicled",
        name: "묶음",
        onlyListed: true,
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
        // 한정: ① 뽑은 횟수만큼 헤드헌팅 데이터 계약(1회 1장) → 300장으로 6성 교환(오래된 한정은 200장, 5성 75장)
        // ② 교환과 별개로, 누적 300회에 그 배너의 한정 6성을 1번 더 받는다(한국 서버 2024-10부터, 게임 데이터 freeCount 300)
        // 둘 다 다음 한정으로 이월 안 됨. 6성 중 픽업 70%
        bannerCounters: [
          { at: 300, label: "교환(데이터 계약)", exchange: true },
          { at: 300, label: "한정 6성 증정" },
        ],
        odds: { base: 0.02, softFrom: 51, step: 0.02 },
        spend: arknightsSpend,
      },
      {
        // 콜라보: 120회마다 픽업 6성 확정, 픽업을 얻을 때마다 처음부터 다시 센다(한국 공식 공지 2026-11, 새 규칙).
        // 예전 콜라보는 "처음 120회 안에 1번"이었다. 배너 풀 ID가 LINKAGE로 시작하는 것
        id: "arknights-collab",
        name: "콜라보",
        hardPity: 99,
        softFrom: 51,
        carryOver: false,
        featuredRule: "none",
        bannerCounters: [{ at: 120, label: "픽업 확정", sinceFeatured: true }],
        odds: { base: 0.02, softFrom: 51, step: 0.02 },
        spend: arknightsSpend,
      },
      {
        id: "arknights-standard",
        name: "일반",
        hardPity: 99,
        softFrom: 51,
        // 표준 헤드헌팅(단일·더블 픽업 등)끼리는 50회 확률 상승 횟수를 함께 세고 배너가 끝나도 이어진다
        // (중국 서버 게임 안 규칙 글 + 일본 공략 일치, 한국 서버 글은 공개 자료에 없음. DESIGN.md §6)
        carryOver: true,
        featuredRule: "none",
        // 지향 셀렉션(단일 픽업): 픽업 없이 150회가 지나면 다음 6성은 픽업, 배너마다 1번(중국 공식 공지)
        // 표준 셀렉션(더블 픽업): 150회 뒤 다음 6성은 픽업 둘 중 하나, 300회 뒤 다음 6성은 나머지(중국 위키가 옮긴 게임 글 — 추정)
        bannerCounters: [
          { at: 150, label: "다음 6성 픽업 확정", untilFeatured: true, next: true, bannerMatch: ":SINGLE_" },
          { at: 150, label: "다음 6성 픽업(둘 중 하나)", untilFeatured: true, next: true, bannerMatch: ":DOUBLE_" },
          { at: 300, label: "다음 6성 남은 픽업", next: true, bannerMatch: ":DOUBLE_" },
        ],
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
      { key: "charteredPermit", label: "특별 허가 헤드헌팅 허가증" },
      { key: "limitedPermit", label: "배너 전용 헤드헌팅 허가증", expiresWith: "endfield-chartered" }, // 배너마다 이름이 바뀌어 이렇게 부른다(사용자 2026-11-26)
      { key: "arsenalTicket", label: "무기고 징표" },
    ],
    // 규칙 출처: 엔드필드 한국어 공식 공지 「확률 상세 안내」·배너 공지(2026-11-26 확인). DESIGN.md §6 엔드필드 절.
    groups: [
      {
        id: "endfield-chartered",
        name: "한정",
        hardPity: 80,
        softFrom: 66,
        carryOver: true, // 80 천장은 다른 특별 허가 헤드헌팅에 계승
        featuredRule: "none", // 50:50, 픽뚫 다음 확정 없음
        bannerCounters: [
          { at: 120, label: "픽업 확정", untilFeatured: true }, // 배너마다 1회, 종료 시 초기화
          { at: 240, label: "픽업 증표", repeat: true },
        ],
        // 긴급 모집(무료 10회)은 천장·누적 횟수에 안 들어감. 60회 정보서는 다음 특별 허가 배너 전용 10회 허가증으로 바뀜
        bonuses: [
          { at: 30, pulls: 10, label: "긴급 모집" },
          { at: 60, pulls: 10, label: "헤드헌팅 정보서(다음 한정 10회)", nextBanner: "limitedPermit" },
        ],
        odds: { base: 0.008, softFrom: 66, step: 0.05 },
        // 픽업 6성은 특별 허가 3회(그 배너 포함)가 끝나면 목록에서 빠진다(공식 「오퍼레이터 제외 규칙」)
        rotation: { stays: 3 },
        freeLabel: "긴급 모집",
        // 무기고 징표: 6성 2000, 그 밖은 최소 20(4성). 5성(200)은 앱이 알 수 없어 20으로 센다 → 실제보다 적게 잡힐 수 있음
        gain: { key: "arsenalTicket", top: 2000, other: 20 },
        spend: [
          { key: "limitedPermit", cost: 1, pulls: 1 },
          { key: "charteredPermit", cost: 1, pulls: 1 },
          { key: "oroberyl", cost: 500, pulls: 1, topUp: { key: "origeometry", rate: 75 } },
        ],
      },
      {
        id: "endfield-refactor",
        name: "재구축",
        hardPity: 80,
        softFrom: 66,
        carryOver: true, // 80 천장은 모든 재구축 헤드헌팅이 공유
        counterScope: "series", // 120 픽업 확정·누적 횟수·긴급 모집은 같은 재구축 이름(#1, #2…)끼리만 계승
        featuredRule: "none",
        bannerCounters: [
          { at: 120, label: "픽업 확정", untilFeatured: true }, // 같은 이름 재구축을 통틀어 1회
          { at: 240, label: "픽업 증표", repeat: true },
        ],
        bonuses: [
          { at: 30, pulls: 10, label: "긴급 모집" },
          { at: 60, pulls: 10, label: "긴급 모집" },
          { at: 90, pulls: 10, label: "긴급 모집" },
        ],
        odds: { base: 0.008, softFrom: 66, step: 0.05 },
        // 픽업 6성은 그 재구축 배너가 끝나면 재구축 목록에서 빠진다(공식). 픽뚫는 늘 나오는 6성뿐
        rotation: { stays: 1 },
        freeLabel: "긴급 모집",
        // 무기고 징표: 6성 2000, 그 밖은 최소 20(4성). 5성(200)은 앱이 알 수 없어 20으로 센다 → 실제보다 적게 잡힐 수 있음
        gain: { key: "arsenalTicket", top: 2000, other: 20 },
        spend: [
          { key: "charteredPermit", cost: 1, pulls: 1 },
          { key: "oroberyl", cost: 500, pulls: 1, topUp: { key: "origeometry", rate: 75 } },
        ],
      },
      {
        // 무기고 신청: 1회 신청 = 무기 10개. 3회 연속 6성 무기가 없으면 4회째 확정(계승 안 됨),
        // 첫 7회에 픽업 무기가 없으면 8회째 픽업 확정(배너마다 1회, 계승 안 됨). 6성 무기 4%, 그중 픽업 25%.
        // 신청 1회 비용(무기고 징표 1980)은 공략 사이트 기준(공식 공지에 없음)
        id: "endfield-arsenal",
        name: "무기고",
        hardPity: 40,
        softFrom: null,
        carryOver: false,
        featuredRule: "none",
        bannerCounters: [{ at: 80, label: "픽업 무기 확정", untilFeatured: true }],
        odds: { base: 0.335167, softFrom: null, step: 0, unit: 10 }, // 신청 1회에 6성 무기 1개 이상: 33.5167%(공식)
        spend: [{ key: "arsenalTicket", cost: 1980, pulls: 10 }],
      },
      {
        // 재구축 신청: 4회째 6성 무기 확정은 계승 안 됨, 8회째 픽업 무기 확정은 같은 이름 재구축 신청끼리 1회·계승
        id: "endfield-refactor-arsenal",
        name: "재구축 신청",
        hardPity: 40,
        softFrom: null,
        carryOver: false,
        counterScope: "series",
        featuredRule: "none",
        bannerCounters: [{ at: 80, label: "픽업 무기 확정", untilFeatured: true }],
        odds: { base: 0.335167, softFrom: null, step: 0, unit: 10 },
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
        // 추출 횟수만큼 "이상"을 얻어 200개로 교환(사용자 확인 2026-11-26)
        bannerCounters: [{ at: 200, label: "교환(이상)", exchange: true }],
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
