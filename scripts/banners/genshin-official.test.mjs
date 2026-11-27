import { describe, expect, it } from "vitest";
import { applyKoreanNames, applyWishPools, wishAnnouncements, wishDetail } from "./genshin-official.mjs";

const data = { list: [{ list: [
  { subtitle: "「사직 의례」 기원", title: "「사직 의례」 기원: 「샘물에 숨은 세월·자백(바위)」 확률 UP!", banner: "https://sdk.hoyoverse.com/upload/ann/2026/11/10/abc_1" },
  { subtitle: "「신의 주조」 기원", title: "「신의 주조」 기원: 「한손검·신월의 달빛」, 「활·서리 맺힌 금빛 가지」 확률 UP!" },
  { subtitle: "「불꽃에 새긴 이름」 기원", title: "「불꽃에 새긴 이름」: 묶음 기원 오픈!" },
  { subtitle: "「검에 서린 설원의 여정」", title: "초심자 혜택 일반 기원" },
] }] };
const b = (id, group, ko, extra = {}) => ({
  id, group, name: "English Name", start: "2026-11-24T02:00:00.000Z", end: "2026-12-14T22:59:00.000Z",
  featured: [{ id: "x", en: "X", ko }], ...extra,
});
const now = new Date("2026-11-25T00:00:00Z");

describe("원신 한국어 기원 이름", () => {
  it("기원 공지만 고른다", () => {
    expect(wishAnnouncements(data).map((a) => a.name)).toEqual(["「사직 의례」 기원", "「신의 주조」 기원", "「불꽃에 새긴 이름」 기원"]);
  });

  it("진행 중인 배너는 픽업 이름으로 공지와 맞춘다", () => {
    const out = applyKoreanNames([
      b("c", "genshin-char", "자백"), b("w", "genshin-weapon", "신월의 달빛"),
      b("k", "genshin-chronicled", null), b("n", "genshin-char", "없는 캐릭터"),
    ], wishAnnouncements(data), [], now);
    expect(out.map((x) => x.name)).toEqual(["「사직 의례」 기원", "「신의 주조」 기원", "「불꽃에 새긴 이름」 기원", "English Name"]);
    expect(out[0].nameEn).toBe("English Name");
    expect(out[3].nameEn).toBeUndefined();
  });

  it("배너 그림은 공지의 한국어 그림, 지난 배너는 이전 팩의 한국어 그림만 이어받는다(영어판 그림은 안 씀)", () => {
    const en = "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/static/images/banners/X%201.png";
    const out = applyKoreanNames([b("c", "genshin-char", "자백")], wishAnnouncements(data), [], now);
    expect(out[0].image).toBe("https://sdk.hoyoverse.com/upload/ann/2026/11/10/abc_1");
    const old = b("o", "genshin-char", "자백", { start: "2026-01-01T00:00:00.000Z", end: "2026-01-20T00:00:00.000Z" });
    expect(applyKoreanNames([old], [], [{ id: "o", image: "https://sdk.hoyoverse.com/upload/ann/x" }], now)[0].image).toBe("https://sdk.hoyoverse.com/upload/ann/x");
    expect(applyKoreanNames([old], [], [{ id: "o", image: en }], now)[0].image).toBeUndefined();
  });

  it("끝난 배너는 공지와 맞추지 않고, 이전 팩의 한국어 이름을 이어받는다", () => {
    const old = b("o", "genshin-char", "자백", { start: "2026-01-01T00:00:00.000Z", end: "2026-01-20T00:00:00.000Z" });
    expect(applyKoreanNames([old], wishAnnouncements(data), [], now)[0].name).toBe("English Name");
    const prev = [{ id: "o", name: "「옛 기원」 기원", nameEn: "English Name" }];
    expect(applyKoreanNames([old], [], prev, now)[0]).toMatchObject({ name: "「옛 기원」 기원", nameEn: "English Name" });
  });
});

describe("원신 기원 상세의 5성 목록", () => {
  const detail = { r5_prob_list: [
    { item_name: "자백", is_up: 1 }, { item_name: "각청", is_up: 0 }, { item_name: "진", is_up: 0 },
  ] };
  const now = new Date("2026-11-26T00:00:00Z");
  it("픽업과 픽업이 아닌 5성을 나눈다. 픽업이 없는 기원(일반·묶음)은 쓰지 않는다", () => {
    expect(wishDetail(detail)).toEqual({ up: ["자백"], pool: ["각청", "진"] });
    expect(wishDetail({ r5_prob_list: [{ item_name: "진", is_up: 0 }] })).toBeNull();
    expect(wishDetail({})).toBeNull();
  });
  it("진행 중이고 픽업이 같은 배너에만 붙이고, 지난 배너는 이전 팩에서 이어받는다", () => {
    const cur = b("c1", "genshin-char", "자백");
    const other = b("c2", "genshin-char", "린네아");
    const old = { ...b("old", "genshin-char", "푸리나"), start: "2026-01-01T00:00:00.000Z", end: "2026-01-20T00:00:00.000Z" };
    const prev = [{ ...old, pool: [{ id: "ko:모나", ko: "모나" }] }];
    const out = applyWishPools([cur, other, old], [wishDetail(detail)], prev, now);
    expect(out[0].pool.map((p) => p.ko)).toEqual(["각청", "진"]);
    expect(out[1].pool).toBeUndefined();
    expect(out[2].pool.map((p) => p.ko)).toEqual(["모나"]);
  });
});
