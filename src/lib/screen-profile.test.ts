import { describe, expect, it } from "vitest";
import { GAMES } from "./games";
import {
  PROFILES, matchTemplate, parseField, profileGaps, readDigits, resultCountingReady, screenReady, type FieldDef, type GameProfile,
} from "./screen-profile";

const field = (over: Partial<FieldDef>): FieldDef => ({
  id: "f", rect: [0, 0, 0.1, 0.1], kind: "digits", use: { type: "currency", key: "oroberyl" }, min: 0, max: 9999999, confirm: 2, ...over,
});

describe("화면 틀 데이터", () => {
  it("네 게임 모두 있고, 그룹 id는 games.ts에 있는 것만 쓴다", () => {
    expect(PROFILES.map((p) => p.game).sort()).toEqual(["arknights", "endfield", "genshin", "limbus"]);
    for (const p of PROFILES) {
      const groups = new Set(GAMES[p.game].groups.map((g) => g.id));
      for (const s of p.screens) if (s.group) expect(groups.has(s.group), `${s.id} → ${s.group}`).toBe(true);
      const ids = p.screens.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it("PC 스크린샷(2026-11-27)으로 채운 뽑기 메인 화면만 준비됨, 결과 화면은 아직 → 뽑기는 예전 방식(재화 차이)으로 센다", () => {
    const ready = PROFILES.flatMap((p) => p.screens.filter(screenReady).map((s) => s.id)).sort();
    expect(ready).toEqual(["arknights-limited-main", "endfield-arsenal-main", "endfield-chartered-main", "endfield-refactor-main", "genshin-char-main", "genshin-weapon-main", "limbus-main"]);
    for (const g of ["genshin", "endfield", "arknights", "limbus"] as const) expect(resultCountingReady(g)).toBe(false);
    expect(profileGaps().length).toBe(PROFILES.reduce((n, p) => n + p.screens.length, 0) - ready.length);
  });
  it("PC 스크린샷 문구 틀: 실제 화면 글자(엔드필드 6성·픽업 확정 줄)", () => {
    const ef = PROFILES.find((p) => p.game === "endfield")!;
    const f = (sid: string, fid: string) => ef.screens.find((s) => s.id === sid)!.fields.find((x) => x.id === fid)!;
    expect(parseField(f("endfield-chartered-main", "toTop"), "77 회의 헤드헌팅 내 6성 오퍼레이터 확정 획득./", ef.fixes)).toMatchObject({ ok: true, value: 77 });
    expect(parseField(f("endfield-refactor-main", "toTop"), "37 회의 헤드헌팅 내 6성 오퍼레이터 확정 획득./", ef.fixes)).toMatchObject({ ok: true, value: 37 });
    expect(parseField(f("endfield-refactor-main", "toFeatured"), "120 회의 헤드헌팅 내 확정 획득", ef.fixes)).toMatchObject({ ok: true, value: 120 });
    // 한정 화면에서 픽업을 이미 받았으면 그 자리에 다른 글자(증표의 선물) → 읽지 않음
    expect(parseField(f("endfield-chartered-main", "toFeatured"), "의 선물", ef.fixes).ok).toBe(false);
    expect(parseField(f("endfield-chartered-main", "exchange"), "11400", ef.fixes)).toMatchObject({ ok: true, value: 152 });
  });
  it("윈도우 글자 인식이 실제로 읽은 글자(PC 시험 2026-11-27, 스크린샷 7장 → src-tauri/examples/region_test)", () => {
    const P = (g: string) => PROFILES.find((p) => p.game === g)!;
    const f = (g: string, sid: string, fid: string) => P(g).screens.find((s) => s.id === sid)!.fields.find((x) => x.id === fid)!;
    const read = (g: string, sid: string, fid: string, raw: string) => parseField(f(g, sid, fid), raw, P(g).fixes);
    // 림버스 광기: 글꼴의 '4'를 'k'로 읽음 → 바꿈 표
    expect(read("limbus", "limbus-main", "lunacy", "58k1k")).toMatchObject({ ok: true, value: 58414 });
    expect(read("genshin", "genshin-char-main", "primogem", "419")).toMatchObject({ ok: true, value: 419 });
    expect(read("genshin", "genshin-weapon-main", "intertwined", "183")).toMatchObject({ ok: true, value: 183 });
    expect(read("arknights", "arknights-limited-main", "orundum", "170280")).toMatchObject({ ok: true, value: 170280 });
    expect(read("arknights", "arknights-limited-main", "exchange", "32760")).toMatchObject({ ok: true, value: 182 });
    expect(read("endfield", "endfield-chartered-main", "charteredPermit", "0")).toMatchObject({ ok: true, value: 0 });
    expect(read("endfield", "endfield-arsenal-main", "arsenalTicket", "8325")).toMatchObject({ ok: true, value: 8325 });
    expect(read("endfield", "endfield-refactor-main", "toTop", "37 회의 해드현팅 내 6성 오퍼레이터 확정 획득./")).toMatchObject({ ok: true, value: 37 });
    expect(read("endfield", "endfield-refactor-main", "toFeatured", "120회의 헤드현팅 내 확정 획득")).toMatchObject({ ok: true, value: 120 });
    // 고치기 전 읽힌 것: 붙은 "00"을 한 글자로 → 75의 배수가 아니라 버림 / 1을 '그'로 → 숫자 덩어리만 남아도 앞에 한글이 붙어 버림
    expect(read("endfield", "endfield-chartered-main", "exchange", "114㈀").ok).toBe(false);
    expect(read("arknights", "arknights-limited-main", "orundum", "그70282").ok).toBe(false);
  });
  it("판단·칸·등급 표시가 다 채워지면 준비됨", () => {
    const probe = { rect: [0, 0, 0.1, 0.1] as [number, number, number, number], hash: "0".repeat(16), rgb: [0, 0, 0] as [number, number, number] };
    const p: GameProfile = { game: "endfield", aspect: 16 / 9, fixes: [], screens: [
      { id: "r", kind: "result", group: null, pulls: 1, detect: [probe], tops: [probe], fields: [] },
    ] };
    expect(screenReady(p.screens[0])).toBe(true);
    expect(resultCountingReady("endfield", [p])).toBe(true);
  });
});

describe("틀로만 해석", () => {
  it("숫자 칸: 0~9 외 글자는 버린다", () => {
    expect(readDigits("55,025")).toBe(55025);
    expect(readDigits("× 2500")).toBe(2500);
    expect(readDigits("+")).toBeNull();
    // 숫자 옆에 글자가 붙으면 잘못 읽은 것(글자를 버리면 틀린 값이 된다)
    expect(readDigits("S8414")).toBeNull();
    expect(readDigits("5841l")).toBeNull();
    expect(readDigits(" 58414 ")).toBe(58414);
    expect(readDigits("l 8390")).toBe(8390);
  });
  it("문구 틀: 공백은 무시, 글자는 정확히 같아야", () => {
    expect(matchTemplate("53 회의 헤드헌팅 내 6성 오퍼레이터 확정 획득./", "{n}회의 헤드헌팅 내 6성")).toBe(53);
    expect(matchTemplate("53 회의 해드현팅 내 6성", "{n}회의 헤드헌팅 내 6성")).toBeNull(); // 추측하지 않음
    expect(matchTemplate("「모루, 배낭」 재구축", "{s} 재구축")).toBe("「모루,배낭」");
  });
  it("실기에서 확인된 오독만 바꿈 표로 고친다", () => {
    const f = field({ id: "toTop", kind: "text", template: "{n}회의 헤드헌팅 내 6성", use: { type: "toTop" }, min: 1, max: 80 });
    expect(parseField(f, "53회의 해드현팅 내6성", [["해드현팅", "헤드헌팅"]])).toMatchObject({ ok: true, value: 53 });
    expect(parseField(f, "530회의 헤드헌팅 내 6성", [])).toMatchObject({ ok: false, reason: "범위 밖" });
    expect(parseField(f, "6성 확정", [])).toMatchObject({ ok: false, reason: "틀 불일치" });
  });
  it("환산 칸은 나눠떨어져야 하고, 빈칸은 '빈칸'", () => {
    const ex = field({ use: { type: "currency", key: "origeometry", divisor: 75 } });
    expect(parseField(ex, "10500", [])).toMatchObject({ ok: true, value: 140 });
    expect(parseField(ex, "10501", [])).toMatchObject({ ok: false, reason: "범위 밖" });
    expect(parseField(field({ rect: null }), "123", [])).toMatchObject({ ok: false, reason: "빈칸" });
    expect(parseField(field({}), "", [])).toMatchObject({ ok: false, reason: "읽지 못함" });
  });
});
