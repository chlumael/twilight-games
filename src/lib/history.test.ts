import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PackBanner } from "./banners";
import { importHistory, mergePages, parseEndfieldHistory, parseRecordTime } from "./history";
import { emptyRecords, recordSession, topHistory } from "./ledger";
import { parseFrameText } from "./recognize";

const phone = parseFrameText(readFileSync(new URL("./fixtures/endfield-history-phone.txt", import.meta.url), "utf8"));
const banner: PackBanner = {
  id: "endfield:official:7012", group: "endfield-chartered", name: "「은하수를 부르는 불꽃」 특별 허가 헤드헌팅",
  start: "2026-11-05T04:00:00.000Z", end: "2026-11-24T04:00:00.000Z", version: null,
  featured: [{ id: "ko:명하", ko: "명하" }], featuredRare: [],
};
let n = 0;
const ctx = { banners: [banner], isTop: (name: string) => ["명하", "케르"].includes(name), newId: () => `id${++n}` };

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

  it("배너를 못 찾으면(기초 헤드헌팅 등) 건너뛴다", () => {
    const out = importHistory(emptyRecords(), "endfield", [{ banner: "기초 헤드헌팅", name: "가", time: "2026-11-01T00:00:00.000Z", emergency: false }], ctx);
    expect(out).toMatchObject({ added: 0, skipped: 1 });
  });
});
