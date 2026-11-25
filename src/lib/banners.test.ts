import { describe, expect, it } from "vitest";
import { activeBanners, autoBanner, bannerLabel, daysLeft, matchFeatured, newerPack, type PackBanner } from "./banners";

const b = (id: string, start: string | null, end: string | null, version = "1.0", ko = id): PackBanner => ({
  id, group: "g", name: `banner ${id}`, start, end, version,
  featured: [{ id: `${id}-char`, en: `${id} EN`, ko }], featuredRare: [],
});

const now = new Date("2026-11-25T00:00:00Z");

describe("banner pack", () => {
  it("finds running banners by date", () => {
    const list = [b("old", "2026-11-01T00:00:00Z", "2026-11-20T00:00:00Z"), b("cur", "2026-11-24T10:00:00Z", "2026-12-15T07:00:00Z")];
    expect(activeBanners(list, now).map((x) => x.id)).toEqual(["cur"]);
    expect(daysLeft(list[1], now)).toBe(21);
  });

  it("uses the newest version when there is no schedule", () => {
    const list = [b("a", null, null, "1.5"), b("b", null, null, "1.6"), b("c", null, null, "1.10")];
    expect(activeBanners(list, now).map((x) => x.id)).toEqual(["c"]);
  });

  it("switches automatically only from empty or expired pack banners", () => {
    const list = [b("old", "2026-11-01T00:00:00Z", "2026-11-20T00:00:00Z"), b("cur", "2026-11-24T10:00:00Z", "2026-12-15T07:00:00Z")];
    expect(autoBanner(list, "", now)).toBe("cur");
    expect(autoBanner(list, "old", now)).toBe("cur");
    expect(autoBanner(list, "cur", now)).toBeNull();
    expect(autoBanner(list, "내가 쓴 배너", now)).toBeNull();
  });

  it("matches featured names in any language", () => {
    const x = b("x", null, null, "1.0", "자백");
    expect(matchFeatured(x, "자백")).toBe(true);
    expect(matchFeatured(x, "x EN")).toBe(true);
    expect(matchFeatured(x, "치치")).toBe(false);
    expect(matchFeatured(undefined, "자백")).toBeNull();
    expect(bannerLabel(x)).toBe("자백");
  });

  it("prefers the newer pack", () => {
    const p1 = { schemaVersion: 1 as const, generatedAt: "2026-11-01T00:00:00Z", games: {} };
    const p2 = { ...p1, generatedAt: "2026-11-20T00:00:00Z" };
    expect(newerPack(p1, p2)).toBe(p2);
    expect(newerPack(null, p1)).toBe(p1);
  });
});
