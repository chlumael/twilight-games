import { describe, expect, it } from "vitest";
import { mergeMine, buildItems, dText, edgeOn, monthCells, onDay, periodText, validMine, ymdStart } from "./calendar";
import type { BannerPack } from "./banners";

const at = (s: string) => new Date(s).getTime();
const pack: BannerPack = {
  schemaVersion: 1, generatedAt: "x",
  games: {
    endfield: [{ id: "b1", group: "endfield-chartered", name: "「모루」 특별 허가 헤드헌팅", start: "2026-11-24T04:00:00Z", end: "2026-12-23T03:59:00Z", version: null, featured: [{ id: "k", ko: "케르" }], featuredRare: [] }],
  },
  events: {
    genshin: [
      { id: "v", kind: "version", title: "7.2 버전", start: "2026-11-03T23:00:00Z", end: "2026-12-15T22:00:00Z" },
      { id: "n", kind: "offline", title: "콜라보 카페", start: "2026-11-30T03:00:00Z", end: null, startApprox: true },
    ],
    endfield: [{ id: "e", kind: "event", title: "새 이벤트", start: "2026-12-16T04:00:00Z", end: null }],
  },
};

describe("달력", () => {
  const items = buildItems(pack, [{ id: "m", title: "팝업 스토어", start: "2026-11-28", end: "2026-11-29", game: null }]);
  it("픽업·이벤트·버전·외부 행사·내 일정을 한 목록으로", () => {
    expect(items.map((i) => i.kind).sort()).toEqual(["event", "mine", "offline", "pickup", "version"]);
    expect(items.find((i) => i.kind === "pickup")).toMatchObject({ game: "endfield", title: "한정 · 케르" });
  });
  it("그날 걸치는 일정: 외부 소식은 그날 하루, 끝 미정 이벤트는 시작 전에는 안 보임, 내 일정은 끝나는 날까지", () => {
    const now = at("2026-11-26T12:00:00");
    const titles = (d: string) => onDay(items, ymdStart(d), now).map((i) => i.title).sort();
    expect(titles("2026-11-29")).toEqual(["7.2 버전", "팝업 스토어", "한정 · 케르"]);
    expect(titles("2026-12-01")).toEqual(["7.2 버전", "한정 · 케르"]);
    expect(titles("2026-12-16")).toContain("새 이벤트");
    expect(titles("2026-12-15")).not.toContain("새 이벤트");
  });
  it("시작·끝 표시와 남은 날", () => {
    const pick = items.find((i) => i.kind === "pickup")!;
    expect(edgeOn(pick, pick.start)).toBe("start");
    expect(periodText(items.find((i) => i.kind === "offline")!)).toMatch(/^11\/30$/);
    expect(periodText(items.find((i) => i.kind === "event")!)).toMatch(/~ 미정$/);
    const now = at("2026-11-26T12:00:00");
    expect(dText(items.find((i) => i.kind === "event")!, now)).toMatch(/일 뒤 시작$/);
  });
  it("달력 칸은 6주 42칸, 일요일부터", () => {
    const cells = monthCells(2026, 10); // 2026년 11월
    expect(cells).toHaveLength(42);
    expect(new Date(cells[0].day).getDay()).toBe(0);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30);
  });
  it("내 일정 확인", () => {
    expect(validMine({ title: "행사", start: "2026-12-01", end: null, game: null })).toBe(true);
    expect(validMine({ title: " ", start: "2026-12-01" })).toBe(false);
    expect(validMine({ title: "행사", start: "2026-12-02", end: "2026-12-01" })).toBe(false);
  });
});

describe("내 일정 기기끼리 합치기", () => {
  const m = (id: string, start = "2026-12-01") => ({ id, title: id, start, end: null, game: null });
  it("양쪽 것을 모두 남기고, 지운 것은 뺀다", () => {
    expect(mergeMine([m("a"), m("b")], [m("b"), m("c", "2026-11-30")], ["a"]).map((x) => x.id)).toEqual(["c", "b"]);
  });
});
