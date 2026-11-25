import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyRecords, recordSession } from "./ledger";
import { applyLimbusHistory, mergeSequence, parseLimbusHistory, sinnerOf, type LimbusRow } from "./limbus-history";
import { parseFrameText } from "./recognize";

const phone = parseFrameText(readFileSync(new URL("./fixtures/limbus-history-phone.txt", import.meta.url), "utf8"));
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
