// 원신 기원 기록 불러오기 결과(src-tauri/src/genshin.rs) → 기록 줄. DESIGN.md §4.9.
import { matchFeatured, type PackBanner } from "./banners";
import { parseRecordTime, type HistoryRow } from "./history";

/** 원신 기원 기록 서버가 주는 한 줄 (필요한 칸만) */
export interface WishItem {
  id: string;
  gacha_type: string;
  name: string;
  item_type: string;
  rank_type: string;
  time: string;
}

export interface WishFetch {
  /** 서버 시간대 (UTC 기준 시) */
  tz: number;
  items: WishItem[];
  /** 기원 종류별 가장 최근 번호 (다음에는 그 뒤만 받는다) */
  latest: Record<string, string>;
}

/** 기원 종류 → 앱의 천장 그룹. 상시(200)·초보자(100)는 추적하지 않는다 */
export function groupOfWish(gachaType: string): string | null {
  if (gachaType === "301" || gachaType === "400") return "genshin-char";
  if (gachaType === "302") return "genshin-weapon";
  if (gachaType === "500") return "genshin-chronicled";
  return null;
}

/** 서버 기록 → 기록 줄 (목록 순서는 서버와 같게 최근이 먼저) */
export function wishRows(fetch: WishFetch): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (const it of fetch.items) {
    const group = groupOfWish(it.gacha_type);
    const time = parseRecordTime(it.time.replace(/-/g, "."), fetch.tz);
    const rarity = Number(it.rank_type);
    if (!group || !time || !it.name || !Number.isInteger(rarity)) continue;
    out.push({ banner: "", name: it.name, time, emergency: false, group, rarity });
  }
  // 서버가 종류별로 따로 주므로 시각순(최근 먼저)으로 합친다. 같은 시각은 원래 순서 유지
  return out.map((r, i) => ({ r, i })).sort((a, b) => b.r.time.localeCompare(a.r.time) || a.i - b.i).map((v) => v.r);
}

/**
 * 픽업 판정: 그 시각에 열려 있던 같은 종류 기원들의 픽업 목록 전체와 이름 비교.
 * (캐릭터 기원 2개가 동시에 열려도, 한쪽 픽업은 다른 쪽에서 나올 수 없으므로 합쳐서 봐도 맞다)
 * 그 시각의 배너를 하나도 모르면 null(모름).
 */
export function wishFeatured(banners: PackBanner[]) {
  return (row: HistoryRow, group: string): boolean | null => {
    const open = banners.filter((b) => b.group === group && b.start && b.start <= row.time && (!b.end || row.time <= b.end));
    if (!open.length) return null;
    return open.some((b) => matchFeatured(b, row.name) === true);
  };
}

export function newestIds(prev: Record<string, string>, latest: Record<string, string>): Record<string, string> {
  return { ...prev, ...latest };
}
