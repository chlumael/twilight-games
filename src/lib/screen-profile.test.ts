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
  it("지금은 스크린샷 전이라 모두 빈칸 → 새 방식은 꺼져 있다", () => {
    expect(PROFILES.every((p) => p.screens.every((s) => !screenReady(s)))).toBe(true);
    expect(resultCountingReady("endfield")).toBe(false);
    expect(profileGaps().length).toBe(PROFILES.reduce((n, p) => n + p.screens.length, 0));
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
