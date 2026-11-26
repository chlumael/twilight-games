export type GameId = "genshin" | "arknights" | "endfield" | "limbus";

export type PullSource = "manual" | "screen" | "official";
export type PullStatus = "confirmed" | "pending";

/** One gacha pull. A 10-pull is ten Pull rows sharing a sessionId. */
export interface Pull {
  id: string;
  time: string; // ISO 8601
  game: GameId;
  group: string; // pity-sharing group id (see games.ts)
  banner: string; // banner name as entered/recognised
  sessionId: string;
  indexInSession: number;
  /** true when this pull is the game's top rarity (5★ / 6★ / 000). */
  top: boolean;
  name: string | null;
  /** For top pulls: was it the featured/target item? null = unknown. */
  featured: boolean | null;
  /** 등급 (원신 3·4·5성 등). 화면에서 읽었을 때만 있다. 없으면 top으로만 판단 */
  rarity?: number | null;
  source: PullSource;
  confidence: number;
  status: PullStatus;
}

/** State the user enters once, for history the app never saw. */
export interface Baseline {
  /** Pulls since last top rarity, before any recorded pull. */
  pity: number;
  /** Genshin char: next top is guaranteed featured. Genshin weapon: fate point is 1. */
  guaranteed: boolean;
  /** Banner the counts below belong to. */
  banner: string;
  /** Pulls already made on that banner (for 120 / 200 / 300 counters). */
  bannerPulls: number;
  /** Featured already obtained on that banner (Endfield 120 guarantee used up). */
  bannerFeaturedGot: boolean;
}

export interface GameRecord {
  pulls: Pull[];
  currency: Record<string, number>;
  currencyUpdatedAt: string | null;
  baseline: Record<string, Baseline>;
  /** Current banner name per pity group. */
  currentBanner: Record<string, string>;
  /** Last local change (ISO). Used to pick the newer copy when syncing devices. */
  updatedAt?: string | null;
  /** 원신 무기·집록: 배너별로 고른 무기(신각의 길). 확정 포인트 계산에 쓴다 */
  chosen?: Record<string, { banner: string; name: string }>;
  /** 재화 예측 설정 (월정액 끝나는 날 등, src/lib/income.ts) */
  income?: import("./income").IncomePlan;
}

export interface UndoEntry {
  game: GameId;
  label: string;
  addedPullIds: string[];
  /** Pulls replaced by this action (restored on undo). */
  replacedPulls: Pull[];
  prevCurrency: Record<string, number>;
}

export interface Records {
  schemaVersion: 1;
  games: Record<GameId, GameRecord>;
  undo: UndoEntry[];
}
