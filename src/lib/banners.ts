// Banner data pack (data/banners.json): known banners per game, refreshed by CI
// and fetched by the app at startup. See DESIGN.md "배너 데이터 팩".
import type { GameId } from "./types";

export interface PackItem {
  id: string;
  en?: string | null;
  cn?: string | null;
  ko?: string | null;
}

export interface PackBanner {
  id: string;
  group: string;
  name: string;
  /** ISO time; null when the source has no schedule (Endfield). */
  start: string | null;
  end: string | null;
  version: string | null;
  featured: PackItem[];
  featuredRare: PackItem[];
}

export interface BannerPack {
  schemaVersion: 1;
  generatedAt: string;
  games: Partial<Record<GameId, PackBanner[]>>;
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
  const dated = list.filter((b) => b.start && b.end);
  if (dated.length) return dated.filter((b) => b.start! <= t && t <= b.end!);
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
  return current === "" || fromPack ? active[0].id : null;
}

/** Was `name` one of the banner's featured top-rarity items? null when unknown. */
export function matchFeatured(b: PackBanner | undefined, name: string | null): boolean | null {
  if (!b || !name || !b.featured.length) return null;
  const n = name.trim().toLowerCase();
  return b.featured.some((i) => [i.ko, i.en, i.cn, i.id].some((x) => x && x.toLowerCase() === n));
}
