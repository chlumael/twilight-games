import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PackBanner } from "./banners";
import { importHistory, mergePages, missingPages, parseArknightsHistory, parseEndfieldHistory, parseGenshinHistory, parseRecordTime } from "./history";
import { emptyRecords, recordDetected, recordSession, topHistory } from "./ledger";
import { parseFrameText } from "./recognize";

const phone = parseFrameText(readFileSync(new URL("./fixtures/endfield-history-phone.txt", import.meta.url), "utf8"));
const banner: PackBanner = {
  id: "endfield:official:7012", group: "endfield-chartered", name: "「은하수를 부르는 불꽃」 특별 허가 헤드헌팅",
  start: "2026-11-05T04:00:00.000Z", end: "2026-11-24T04:00:00.000Z", version: null,
  featured: [{ id: "ko:명하", ko: "명하" }], featuredRare: [],
};
let n = 0;
const ctx = { banners: [banner], topRarity: 6, isTop: (name: string) => ["명하", "케르"].includes(name), newId: () => `id${++n}` };
const fixture = (f: string) => parseFrameText(readFileSync(new URL(`./fixtures/${f}.txt`, import.meta.url), "utf8"));

describe("엔드필드 공식 기록 읽기", () => {
  it("시각: 서버 시간(UTC+8), OCR이 1을 l로 읽어도", () => {
    expect(parseRecordTime("2026. 11. 07 07:49:25", 8)).toBe("2026-11-06T23:49:25.000Z");
    expect(parseRecordTime("2026. 1l. 06 07:09:21", 8)).toBe("2026-11-05T23:09:21.000Z");
    expect(parseRecordTime("2026. 11, 05 12:05:12", 8)).toBe("2026-11-05T04:05:12.000Z");
    expect(parseRecordTime("이름", 8)).toBeNull();
  });

  it("실기: 기록 화면 한 쪽 — 줄 5개, 긴급 모집 구분, 쪽 번호", () => {
    const p = parseEndfieldHistory(phone)!;
    expect(p.page).toBe(1);
    expect(p.rows.map((r) => [r.banner, r.name, r.emergency])).toEqual([
      ["은하수를 부르는 불꽃", "플루라이트", false],
      ["은하수를 부르는 불꽃", "에스텔라", false],
      ["은하수를 부르는 불꽃", "카치르", false],
      ["은하수를 부르는 불꽃", "알레쉬", true],
      ["은하수를 부르는 불꽃", "에스텔라", true],
    ]);
  });

  it("PC 실기(2026-11-28): 콜론이 빠진 시각·'NEW! 케르 (6*)'도 읽는다", async () => {
    const { normalizeFrame } = await import("./recognize");
    const pc = normalizeFrame(parseFrameText(readFileSync(new URL("./fixtures/endfield-history-pc.txt", import.meta.url), "utf8")));
    const p = parseEndfieldHistory(pc)!;
    expect(p.page).toBe(1);
    // "0541刀9"는 콜론 자리를 알 수 없어 버린다(틀린 시각을 넣지 않음)
    expect(p.rows.map((r) => [r.name, r.time, r.rarity ?? null])).toEqual([
      ["에스텔라", "2026-11-26T22:11:41.000Z", null],
      ["카치르", "2026-11-25T21:41:06.000Z", null],
      ["케르", "2026-11-25T14:24:46.000Z", 6],
      ["플루라이트", "2026-11-25T14:24:44.000Z", null],
    ]);
    expect(p.rows.every((r) => r.banner === "모루, 배낭, 그리고 벌꿀")).toBe(true);
  });

  it("콜론이 다르게 읽힌 시각", () => {
    expect(parseRecordTime("2026. 11. 27 0611141", 8)).toBe("2026-11-26T22:11:41.000Z");
    expect(parseRecordTime("2026. 11. 26 05141109", 8)).toBe("2026-11-25T21:41:09.000Z");
    expect(parseRecordTime("2026. 11. 26 05!41!06", 8)).toBe("2026-11-25T21:41:06.000Z");
    expect(parseRecordTime("2026. 11. 25 2T24꽤6", 8)).toBeNull();
    expect(parseRecordTime("2026. 11. 26 0541刀9", 8)).toBeNull();
  });

  it("같은 쪽을 여러 번 읽어도 한 번, 같은 시각 같은 이름 두 줄은 둘 다", () => {
    const p = parseEndfieldHistory(phone)!;
    let store = mergePages({}, p);
    store = mergePages(store, p);
    expect(Object.keys(store)).toHaveLength(5);
    const twin = { ...p, rows: [p.rows[1], p.rows[1]] };
    expect(Object.keys(mergePages({}, twin))).toHaveLength(2);
  });

  it("반영: 긴급 모집 제외, 구간 안 기존 뽑기를 공식 기록으로 교체, 6성 판별", () => {
    let r = emptyRecords();
    r.games.endfield.currentBanner["endfield-chartered"] = banner.id;
    // 화면 감지로 들어간 기존 기록(같은 시간대) 하나
    r = recordSession(r, "endfield", "endfield-chartered", 1, new Map(), new Date("2026-11-06T23:49:30Z"));
    const rows = [...parseEndfieldHistory(phone)!.rows, { banner: "은하수를 부르는 불꽃", name: "명하", time: "2026-11-07T00:10:00.000Z", emergency: false }];
    const out = importHistory(r, "endfield", rows, ctx);
    expect(out).toMatchObject({ added: 4, replaced: 1, skipped: 2 });
    const pulls = out.records.games.endfield.pulls;
    expect(pulls.map((p) => p.name)).toEqual(["카치르", "에스텔라", "플루라이트", "명하"]);
    expect(pulls.every((p) => p.source === "official" && p.banner === banner.id)).toBe(true);
    const hits = topHistory(out.records.games.endfield, "endfield-chartered");
    expect(hits.map((h) => [h.pull.name, h.count, h.pull.featured])).toEqual([["명하", 4, true]]);
    expect(out.records.undo.at(-1)?.replacedPulls).toHaveLength(1);
  });

  it("반영: 화면 감지 기록은 몇 분 늦게 찍혀도 같은 뽑기로 보고 바꾼다 (두 번 세지 않음)", () => {
    let r = emptyRecords();
    r.games.endfield.currentBanner["endfield-chartered"] = banner.id;
    r = recordDetected(r, "endfield", "endfield-chartered", 3, [], {}, new Date("2026-11-07T00:13:00Z")); // 공식 기록 3분 뒤
    r = recordSession(r, "endfield", "endfield-chartered", 1, new Map(), new Date("2026-11-07T00:13:00Z")); // 직접 입력은 그대로
    const rows = [...parseEndfieldHistory(phone)!.rows, { banner: "은하수를 부르는 불꽃", name: "명하", time: "2026-11-07T00:10:00.000Z", emergency: false }];
    const out = importHistory(r, "endfield", rows, ctx);
    expect(out).toMatchObject({ added: 4, replaced: 3 });
    expect(out.records.games.endfield.pulls.filter((p) => p.source === "manual")).toHaveLength(1);
  });

  it("반영: 직접 입력 기록은 그대로 두는 것이 기본, replaceManual이면 공식 기록으로 바꾼다", () => {
    let r = emptyRecords();
    r.games.endfield.currentBanner["endfield-chartered"] = banner.id;
    r = recordSession(r, "endfield", "endfield-chartered", 5, new Map(), new Date("2026-11-26T00:00:00Z")); // 나중에 손으로 넣은 5회
    const rows = parseEndfieldHistory(phone)!.rows;
    expect(importHistory(r, "endfield", rows, ctx).records.games.endfield.pulls.filter((p) => p.source === "manual")).toHaveLength(5);
    const out = importHistory(r, "endfield", rows, { ...ctx, replaceManual: true });
    expect(out.records.games.endfield.pulls.every((p) => p.source === "official")).toBe(true);
  });

  it("배너를 못 찾으면(기초 헤드헌팅 등) 건너뛴다", () => {
    const out = importHistory(emptyRecords(), "endfield", [{ banner: "기초 헤드헌팅", name: "가", time: "2026-11-01T00:00:00.000Z", emergency: false }], ctx);
    expect(out).toMatchObject({ added: 0, skipped: 1 });
  });
});

describe("원신 기원 기록 읽기", () => {
  const rarity = (n: string) => ({ 혹술창: 3, 흑술창: 3, "마도 서론": 3, 비천어검: 3 } as Record<string, number>)[n] ?? null;
  it("실기: 이름(4) 표시로 등급, 기원 유형으로 종류, 시각은 아시아 서버", () => {
    const p = parseGenshinHistory(fixture("genshin-history-phone"), rarity)!;
    expect(p.page).toBe(1);
    expect(p.rows.map((r) => [r.name, r.rarity, r.group])).toEqual([
      ["혹술창", 3, "genshin-char"], ["마도 서론", 3, "genshin-char"], ["비천어검", 3, "genshin-char"],
      ["흑술창", 3, "genshin-char"], ["발레리", 4, "genshin-char"],
    ]);
    expect(p.rows[0].time).toBe("2026-11-08T11:25:56.000Z");
  });
  it("반영: 등급은 줄의 값, 4성 이름도 남김", () => {
    const rows = parseGenshinHistory(fixture("genshin-history-phone"), rarity)!.rows;
    const out = importHistory(emptyRecords(), "genshin", rows, { banners: [], topRarity: 5, isTop: () => false, minNamedRarity: 4, newId: () => `g${++n}` });
    expect(out.added).toBe(5);
    expect(out.records.games.genshin.pulls.filter((p) => p.name === null)).toHaveLength(4); // 3성은 이름 없이 횟수만
    const four = out.records.games.genshin.pulls.find((p) => p.name === "발레리");
    expect(four).toMatchObject({ rarity: 4, top: false, group: "genshin-char", source: "official" });
  });
});

describe("명일방주 요스타 가챠 기록 읽기", () => {
  it("실기: 날짜 줄 + 시각 줄, 배너·이름, UTC+9", () => {
    const p = parseArknightsHistory(fixture("arknights-history-phone"))!;
    expect(p.rows).toHaveLength(10);
    expect(p.rows.map((r) => r.name)).toEqual(["미르", "시라유키", "라바", "메이", "애쉬락", "크루스", "캐터펄트", "포푸카", "비글", "휴머스"]);
    expect(p.rows[0]).toMatchObject({ banner: "커널 헤드헌팅", time: "2026-11-04T12:21:59.000Z" });
  });
  it("반영: 커널 헤드헌팅처럼 종류를 못 정한 배너는 건너뛴다", () => {
    const rows = parseArknightsHistory(fixture("arknights-history-phone"))!.rows;
    const out = importHistory(emptyRecords(), "arknights", rows, {
      banners: [], topRarity: 6, isTop: () => false, groupOf: (b) => (/커널/.test(b) ? null : "arknights-limited"), newId: () => `a${++n}`,
    });
    expect(out).toMatchObject({ added: 0, skipped: 10 });
  });
});

describe("빠진 쪽 확인", () => {
  it("읽은 쪽 사이에 빠진 쪽을 찾는다", () => {
    const row = { banner: "b", name: "n", time: "2026-11-01T00:00:00.000Z", emergency: false };
    let store = mergePages({}, { game: "endfield", page: 1, rows: [row] });
    store = mergePages(store, { game: "endfield", page: 2, rows: [{ ...row, name: "m" }] });
    expect(missingPages(store)).toEqual([]);
    store = mergePages(store, { game: "endfield", page: 5, rows: [{ ...row, name: "k" }] });
    expect(missingPages(store)).toEqual([3, 4]);
    expect(missingPages(mergePages({}, { game: "arknights", page: null, rows: [row] }))).toEqual([]);
  });
});
