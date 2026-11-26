import { describe, expect, it } from "vitest";
import type { PackBanner } from "./banners";
import { groupOfWish, wishFeatured, wishRows } from "./genshin-wish";
import { importHistory } from "./history";
import { emptyRecords, groupStatus } from "./ledger";

const item = (id: string, gacha_type: string, name: string, rank: string, time: string) =>
  ({ id, gacha_type, name, item_type: "캐릭터", rank_type: rank, time });

const banner = (id: string, group: string, featured: string[]): PackBanner => ({
  id, group, name: id, start: "2026-11-01T00:00:00.000Z", end: "2026-11-30T00:00:00.000Z",
  featured: featured.map((ko) => ({ id: ko, ko })), featuredRare: [],
} as unknown as PackBanner);

describe("원신 기원 기록 불러오기", () => {
  it("기원 종류 → 천장 그룹 (상시·초보자는 제외)", () => {
    expect([groupOfWish("301"), groupOfWish("400"), groupOfWish("302"), groupOfWish("500"), groupOfWish("200")])
      .toEqual(["genshin-char", "genshin-char", "genshin-weapon", "genshin-chronicled", null]);
  });

  it("서버 시간(UTC+8) → 기록, 픽업은 동시에 열린 캐릭터 기원 둘 다 보고 판정, 천장·픽뚫 계산", () => {
    const rows = wishRows({ tz: 8, latest: {}, items: [
      item("5", "400", "푸리나", "5", "2026-11-20 12:00:05"),   // 두 번째 캐릭터 기원의 픽업
      item("4", "301", "딜루크", "5", "2026-11-20 12:00:04"),   // 상시 5성 → 픽뚫
      item("3", "301", "향릉", "4", "2026-11-20 12:00:03"),
      item("1", "200", "치치", "5", "2026-11-19 12:00:00"),     // 상시 기원 → 빠짐
    ] });
    expect(rows.map((r) => [r.name, r.time, r.group])).toEqual([
      ["푸리나", "2026-11-20T04:00:05.000Z", "genshin-char"],
      ["딜루크", "2026-11-20T04:00:04.000Z", "genshin-char"],
      ["향릉", "2026-11-20T04:00:03.000Z", "genshin-char"],
    ]);
    const banners = [banner("a", "genshin-char", ["느비예트"]), banner("b", "genshin-char", ["푸리나"])];
    const out = importHistory(emptyRecords(), "genshin", rows, {
      banners, topRarity: 5, isTop: () => false, minNamedRarity: 4, featuredOf: wishFeatured(banners), newId: () => Math.random().toString(36),
    });
    const pulls = out.records.games.genshin.pulls;
    expect(pulls.map((p) => [p.name, p.top, p.featured])).toEqual([["향릉", false, null], ["딜루크", true, false], ["푸리나", true, true]]);
    expect(groupStatus(out.records.games.genshin, "genshin", "genshin-char")).toMatchObject({ pity: 0, guaranteed: false });
  });
});
