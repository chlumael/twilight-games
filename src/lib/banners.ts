// Banner data pack (data/banners.json): known banners per game, refreshed by CI
// and fetched by the app at startup. See DESIGN.md "배너 데이터 팩".
import type { GameId } from "./types";

export interface PackItem {
  id: string;
  en?: string | null;
  cn?: string | null;
  ko?: string | null;
  /** 등급 표시 (림버스: 000·00·E.G.O 등급). 없으면 그 게임의 최고 등급 */
  grade?: string;
}

export interface PackBanner {
  id: string;
  group: string;
  name: string;
  /** 한국어 이름을 붙인 경우의 원래 영어 이름 */
  nameEn?: string;
  /** ISO 시각. 출처에 일정이 없으면 null. start만 있고 end가 null이면 종료일 미정(진행 중). */
  start: string | null;
  end: string | null;
  /** 공지에 날짜 대신 "버전 업데이트 후/전까지"로 적혀 있어 근사값으로 채운 경우 */
  startApprox?: boolean;
  endApprox?: boolean;
  /** 그림 글자를 확신 있게 읽지 못해 사람 확인이 필요한 배너 */
  needsReview?: boolean;
  /** 이 정보를 읽어 온 곳 (예: "공식 홈페이지 공지") */
  source?: string;
  version: string | null;
  /** 엔드필드 재구축: 같은 시리즈끼리만 천장 이월. 배너 이름에 붙는 시리즈 이름(모르면 없음) */
  series?: string;
  featured: PackItem[];
  featuredRare: PackItem[];
  /** 이 배너에서 나올 수 있는 픽업 아닌 최고 등급 목록 (엔드필드: 공지의 6성 목록·[6성 무기] 표) */
  pool?: PackItem[];
}

export interface BannerPack {
  schemaVersion: 1;
  generatedAt: string;
  games: Partial<Record<GameId, PackBanner[]>>;
  /** 달력 일정(게임 안 이벤트·버전·외부 소식). scripts/banners/events.mjs */
  events?: Partial<Record<GameId, PackEvent[]>>;
}

/** 배너 자료 파일에 들어 있는 달력 일정 한 건 */
export interface PackEvent {
  id: string;
  kind: "event" | "version" | "offline";
  title: string;
  start: string;
  end: string | null;
  startApprox?: boolean;
  endApprox?: boolean;
  source?: string;
  url?: string;
}

export const PACK_URL = "https://raw.githubusercontent.com/chlumael/twilight-games/main/data/banners.json";

export function itemName(i: PackItem): string {
  return i.ko ?? i.en ?? i.cn ?? i.id;
}

export function isPack(raw: unknown): raw is BannerPack {
  const p = raw as BannerPack;
  return !!p && p.schemaVersion === 1 && typeof p.generatedAt === "string" && typeof p.games === "object";
}

/** Prefer the most recently generated pack. */
export function newerPack(a: BannerPack | null, b: BannerPack | null): BannerPack | null {
  if (!a) return b;
  if (!b) return a;
  return a.generatedAt >= b.generatedAt ? a : b;
}

export function groupBanners(pack: BannerPack | null, game: GameId, group: string): PackBanner[] {
  return (pack?.games[game] ?? []).filter((b) => b.group === group);
}

function versionKey(v: string | null): number[] {
  return (v ?? "0").split(".").map((x) => Number(x) || 0);
}

function cmpVersion(a: string | null, b: string | null): number {
  const x = versionKey(a), y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

/**
 * Banners running now. Without a schedule (Endfield) the banners of the
 * newest version are returned as candidates; the screen decides later.
 */
export function activeBanners(list: PackBanner[], now: Date = new Date()): PackBanner[] {
  const t = now.toISOString();
  const dated = list.filter((b) => b.start);
  if (dated.length) return dated.filter((b) => b.start! <= t && (!b.end || t <= b.end));
  const undated = list.filter((b) => !b.start);
  if (!undated.length) return [];
  const newest = undated.reduce((m, b) => (cmpVersion(b.version, m) > 0 ? b.version : m), undated[0].version);
  return undated.filter((b) => cmpVersion(b.version, newest) === 0);
}

/** Short label: the featured top-rarity names, falling back to the banner name. */
export function bannerLabel(b: PackBanner): string {
  const names = b.featured.map(itemName);
  return names.length ? names.join(" · ") : b.name;
}

export function daysLeft(b: PackBanner, now: Date = new Date()): number | null {
  if (!b.end) return null;
  return Math.max(0, Math.ceil((Date.parse(b.end) - now.getTime()) / 864e5));
}

/**
 * The banner to switch to automatically, or null to keep the current one.
 * Only replaces an empty value or a pack banner that is no longer running,
 * never a name the user typed.
 */
export function autoBanner(list: PackBanner[], current: string, now: Date = new Date()): string | null {
  const active = activeBanners(list, now);
  if (!active.length || active.some((b) => b.id === current)) return null;
  const fromPack = list.some((b) => b.id === current);
  // 여러 개가 함께 열려 있으면(엔드필드 무기고 신청 등) 가장 최근에 열린 것. 시작이 같으면 원래 순서
  const newest = active.reduce((m, b) => ((b.start ?? "") > (m.start ?? "") ? b : m), active[0]);
  return current === "" || fromPack ? newest.id : null;
}

/** Was `name` one of the banner's featured top-rarity items? null when unknown. */
export function matchFeatured(b: PackBanner | undefined, name: string | null): boolean | null {
  if (!b || !name || !b.featured.length) return null;
  const n = name.trim().toLowerCase();
  return b.featured.some((i) => [i.ko, i.en, i.cn, i.id].some((x) => x && x.toLowerCase() === n));
}

export type BannerState = "upcoming" | "active" | "ended" | "unknown";

/** 예정 / 진행 중 / 종료. 일정이 없으면 unknown. */
export function bannerState(b: PackBanner, now: Date = new Date()): BannerState {
  if (!b.start) return "unknown";
  const t = now.toISOString();
  if (t < b.start) return "upcoming";
  return !b.end || t <= b.end ? "active" : "ended";
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "11월 24일(화) 13:00" — 보는 사람의 현지 시각. 올해가 아니면 연도를 붙인다. */
export function formatMoment(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const year = d.getFullYear() === now.getFullYear() ? "" : `${d.getFullYear()}년 `;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일(${WEEKDAYS[d.getDay()]}) ${hm}`;
}

/** "21일 3시간 남음" / "5시간 남음" / "40분 남음". 종료일이 없거나 지났으면 null. */
export function remainingText(b: PackBanner, now: Date = new Date()): string | null {
  if (!b.end) return null;
  const ms = Date.parse(b.end) - now.getTime();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 864e5);
  const hours = Math.floor((ms % 864e5) / 36e5);
  if (days > 0) return `${days}일 ${hours}시간 남음`;
  if (hours > 0) return `${hours}시간 남음`;
  return `${Math.max(1, Math.floor(ms / 6e4))}분 남음`;
}

/** 기간 중 지난 비율 0~1. 시작·종료가 모두 있어야 한다. */
export function bannerProgress(b: PackBanner, now: Date = new Date()): number | null {
  if (!b.start || !b.end) return null;
  const a = Date.parse(b.start), z = Date.parse(b.end);
  if (z <= a) return null;
  return Math.min(1, Math.max(0, (now.getTime() - a) / (z - a)));
}

/** 전체 기간 길이(일). */
export function bannerDays(b: PackBanner): number | null {
  if (!b.start || !b.end) return null;
  return Math.round((Date.parse(b.end) - Date.parse(b.start)) / 864e5);
}

export interface PoolEntry {
  name: string;
  /** 이 배너의 픽업인지 */
  featured: boolean;
  /**
   * 이 배너를 포함해 앞으로 몇 번의 배너까지 나오는지. null = 계속 나옴(늘 있는 최고 등급),
   * undefined = 알 수 없음(규칙으로 설명되지 않는 이름).
   */
  left?: number | null;
}

/**
 * 이 배너에서 나올 수 있는 최고 등급 목록을 규칙에 맞춰 만든다 (DESIGN.md §6 엔드필드 「오퍼레이터 제외 규칙」).
 * - 팩에 공식 목록(`pool`)이 있으면 그 이름들을 쓰고, 없으면 규칙으로 만든다:
 *   늘 나오는 최고 등급 + 같은 종류의 앞선 (stays−1)개 배너의 픽업.
 * - 늘 나오는 최고 등급 = 규칙이 있는 종류의 배너들 공식 목록에 한 번도 빠지지 않고 들어 있는 이름.
 * `all` = 그 게임의 배너 전체, `rules` = 종류별 `rotation.stays`.
 */
export function bannerPool(all: PackBanner[], banner: PackBanner, rules: Record<string, number>): { entries: PoolEntry[]; byRule: boolean } {
  const stays = rules[banner.group];
  const featured = banner.featured.map(itemName);
  if (!stays) {
    return { entries: [...featured.map((name) => ({ name, featured: true })), ...(banner.pool ?? []).map((i) => ({ name: itemName(i), featured: false }))], byRule: false };
  }
  const listed = all.filter((b) => rules[b.group] && b.pool?.length);
  const always = new Set(listed.length ? listed[0].pool!.map(itemName).filter((n) => listed.every((b) => b.pool!.some((i) => itemName(i) === n))) : []);
  const same = all.filter((b) => b.group === banner.group && b.start).sort((a, b) => a.start!.localeCompare(b.start!));
  const at = same.findIndex((b) => b.id === banner.id);
  // 앞선 배너의 픽업: k개 앞 배너의 픽업은 이 배너 포함 (stays − k)번 더 나온다
  const limited = new Map<string, number>();
  for (let k = stays - 1; k >= 1; k--) {
    for (const f of at >= k ? same[at - k].featured : []) limited.set(itemName(f), stays - k);
  }
  for (const n of featured) limited.delete(n);
  const names = banner.pool?.length ? banner.pool.map(itemName) : [...limited.keys()].reverse().concat([...always].filter((n) => !limited.has(n)));
  const entries: PoolEntry[] = [
    ...featured.map((name) => ({ name, featured: true, left: stays })),
    ...names.filter((n) => !featured.includes(n)).map((name) => ({ name, featured: false, left: limited.get(name) ?? (always.has(name) ? null : undefined) })),
  ];
  return { entries, byRule: !banner.pool?.length };
}

/** "이번 배너까지" 같은 남은 기간 문구. 계속 나오거나 모르면 빈 글 */
export function leftText(left: number | null | undefined): string {
  if (left == null) return "";
  if (left <= 1) return "이번 배너까지";
  if (left === 2) return "다음 배너까지";
  return `이번 포함 ${left}개 배너`;
}
