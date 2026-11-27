import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyRecords, recordSession } from "./ledger";
import { applyLimbusHistory, mergeSequence, parseLimbusHistory, sinnerOf, type LimbusRow } from "./limbus-history";
import { parseFrameText } from "./recognize";

const phone = parseFrameText(readFileSync(new URL("./fixtures/limbus-history-phone.txt", import.meta.url), "utf8"));
const phone2 = parseFrameText(readFileSync(new URL("./fixtures/limbus-history-phone2.txt", import.meta.url), "utf8"));
let n = 0;
const id = () => `l${++n}`;
const R = (name: string, top = false): LimbusRow => ({ name, top });

describe("림버스 추출 이력", () => {
  it("수감자 이름 바로잡기", () => {
    expect(sinnerOf("오리스")).toBe("오티스");
    expect(sinnerOf("뫼르소")).toBe("뫼르소");
    expect(sinnerOf("LCB 수감자")).toBeNull();
  });

  it("실기: 줄 3개, 000 표시로 등급, 위가 잘린 항목 없음", () => {
    expect(parseLimbusHistory(phone)).toEqual([
      R("LCB 수감자 그레고르"), R("LCB 수감자 뫼르소"), R("쇄기 사무소 대표 오티스", true),
    ]);
  });

  it("실기(2026-11-27): 수감자 이름이 잘못 읽힌 줄(뫼르소 → \"미르\")도 인격 이름 목록으로 찾는다", () => {
    expect(parseLimbusHistory(phone2, ["데드레빗츠 보스 뫼르소", "데드레빗츠 보스 로쟈"])).toEqual([
      R("LCB 수감자 돈키호테"), R("LCB 수감자 히스클리프"), R("데드레빗츠 보스 뫼르소"),
    ]);
    // 이름 목록이 없으면 그 줄은 건너뛴다(짐작하지 않음)
    expect(parseLimbusHistory(phone2)).toHaveLength(2);
  });

  it("배너 자료의 이름으로 OCR 오타 바로잡기", () => {
    expect(parseLimbusHistory(phone, ["쐐기 사무소 대표 오티스"])?.[2].name).toBe("쐐기 사무소 대표 오티스");
  });

  it("스크롤로 여러 번 읽은 목록 이어 붙이기", () => {
    const a = [R("가"), R("나"), R("다")];
    expect(mergeSequence(a, [R("나"), R("다"), R("라")]).map((r) => r.name)).toEqual(["가", "나", "다", "라"]);
    expect(mergeSequence(a, [R("마"), R("가"), R("나")]).map((r) => r.name)).toEqual(["마", "가", "나", "다"]);
    expect(mergeSequence(a, a)).toEqual(a);
  });

  it("앱의 이름 없는 뽑기에 위에서부터 이름·000을 채우고, 남는 줄은 새로 넣는다", () => {
    let r = emptyRecords();
    r = recordSession(r, "limbus", "limbus-extraction", 2, new Map(), new Date("2026-11-25T10:00:00Z"));
    const out = applyLimbusHistory(r, [R("가", true), R("나"), R("다"), R("라")], new Date("2026-11-25T11:00:00Z"), id);
    expect(out).toMatchObject({ filled: 2, added: 2, known: 0 });
    const pulls = out.records.games.limbus.pulls.sort((a, b) => b.time.localeCompare(a.time) || b.indexInSession - a.indexInSession);
    expect(pulls.map((p) => [p.name, p.top])).toEqual([["가", true], ["나", false], ["다", false], ["라", false]]);
    expect(pulls[3].time < pulls[1].time).toBe(true);
  });

  it("두 번째로 읽을 때: 이미 채운 줄은 건너뛰고 새 줄만", () => {
    let r = emptyRecords();
    r = applyLimbusHistory(r, [R("다"), R("라")], new Date("2026-11-25T09:00:00Z"), id).records;
    r = recordSession(r, "limbus", "limbus-extraction", 1, new Map(), new Date("2026-11-25T10:00:00Z"));
    const out = applyLimbusHistory(r, [R("가", true), R("다"), R("라")], new Date("2026-11-25T11:00:00Z"), id);
    expect(out).toMatchObject({ filled: 1, added: 0, known: 2 });
    expect(out.records.games.limbus.pulls.find((p) => p.name === "가")?.top).toBe(true);
  });
});

describe("림버스 이력 이름 바로잡기는 같은 수감자 안에서만", () => {
  it("수감자가 다른 비슷한 인격으로 바꾸지 않는다", async () => {
    const { parseLimbusHistory: parse } = await import("./limbus-history");
    const { parseFrameText: pf } = await import("./recognize");
    const f = pf(["0.46,0.08 0.08x0.04 추출 이력", "0.41,0.31 0.06x0.03 W사 3등급 정리 요원", "0.41,0.35 0.04x0.02 이상", "0.39,0.63 0.22x0.02 지난 15일간 이력이 최대 20건 표기됩니다."].join("\n"));
    expect(parse(f, ["W사 3등급 정리 요원 홍루"])?.[0].name).toBe("W사 3등급 정리 요원 이상");
  });
});

describe("이력 조각 이어 붙이기 실패 알아내기", () => {
  it("겹치는 줄이 없으면 null(그사이를 놓침), 겹치면 이어 붙인다", async () => {
    const { joinSequence } = await import("./limbus-history");
    const r = (n: string) => ({ name: n, top: false });
    expect(joinSequence([r("가"), r("나"), r("다")], [r("나"), r("다"), r("라")])?.map((x) => x.name)).toEqual(["가", "나", "다", "라"]);
    expect(joinSequence([r("가"), r("나"), r("다")], [r("마"), r("바"), r("사")])).toBeNull();
    expect(joinSequence([], [r("가")])?.length).toBe(1);
  });
});

describe("E.G.O 줄 (등급이 ZAYIN·TETH 등)", () => {
  it("등급 글자를 제목으로 잡지 않고, 000이 아니다", async () => {
    const { parseLimbusHistory: parse } = await import("./limbus-history");
    const { parseFrameText: pf } = await import("./recognize");
    const f = pf(["0.46,0.08 0.08x0.04 추출 이력", "0.41,0.27 0.04x0.02 TETH", "0.41,0.31 0.06x0.03 입주 신고", "0.41,0.35 0.04x0.02 그레고르",
      "0.41,0.42 0.04x0.02 TETH", "0.41,0.47 0.04x0.02 그레고르", "0.39,0.63 0.22x0.02 지난 15일간 이력이 최대 20건 표기됩니다."].join("\n"));
    // 두 번째는 제목이 잘린 줄 → "TETH 그레고르"로 잘못 만들지 않고 건너뛴다
    expect(parse(f, ["입주 신고 그레고르"])).toEqual([{ name: "입주 신고 그레고르", top: false }]);
  });
});
