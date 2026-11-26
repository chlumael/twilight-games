import { describe, expect, it } from "vitest";
import { emptyEngineState, engineStep, type EngineAction, type RegionFrame } from "./engine";
import type { GameProfile } from "./screen-profile";

const R: [number, number, number, number] = [0, 0, 0.1, 0.1];
const probe = { rect: R, hash: "0".repeat(16), rgb: [0, 0, 0] as [number, number, number] };
const profile: GameProfile = {
  game: "endfield", aspect: 16 / 9, fixes: [["해드현팅", "헤드헌팅"]],
  screens: [
    { id: "main", kind: "main", group: "endfield-chartered", detect: [probe], fields: [
      { id: "oroberyl", rect: R, kind: "digits", use: { type: "currency", key: "oroberyl" }, min: 0, max: 9999999, confirm: 2 },
      { id: "toTop", rect: R, kind: "text", template: "{n}회의 헤드헌팅 내 6성", use: { type: "toTop" }, min: 1, max: 80, confirm: 2 },
    ] },
    { id: "r10", kind: "result", group: null, pulls: 10, detect: [probe], tops: Array(10).fill(probe), fields: [] },
  ],
};
const main = (oro: string, top: string, time: number): RegionFrame =>
  ({ time, width: 1920, height: 1080, screen: "main", fields: { oroberyl: oro, toTop: top }, tops: [], prints: [] });
const result = (time: number, tops: boolean[]): RegionFrame =>
  ({ time, width: 1920, height: 1080, screen: "r10", fields: {}, tops, prints: Array(10).fill("0".repeat(16)) });

function play(frames: RegionFrame[]) {
  let s = emptyEngineState();
  const actions: EngineAction[] = [];
  for (const f of frames) {
    const o = engineStep(s, f, [profile]);
    s = o.state;
    actions.push(...o.actions);
  }
  return { s, actions };
}

describe("새 인식 엔진", () => {
  it("뽑기 화면: 두 번 연속 같은 값만 반영 (재화, 천장)", () => {
    const { actions } = play([main("55025", "53회의 해드현팅 내 6성", 1), main("55025", "53회의 해드현팅 내 6성", 2)]);
    expect(actions).toEqual([
      { type: "currency", game: "endfield", values: { oroberyl: 55025 } },
      { type: "pity", game: "endfield", group: "endfield-chartered", toTop: 53, toFeatured: null },
    ]);
  });
  it("결과 화면: 한 번 세고, 6성 자리를 알려 준다. 뒤이은 천장 값(10 줄어듦)은 정상으로 본다", () => {
    const tops = Array(10).fill(false);
    tops[6] = true;
    const { actions } = play([
      main("55025", "53회의 헤드헌팅 내 6성", 1), main("55025", "53회의 헤드헌팅 내 6성", 2),
      result(3, tops), result(4, tops), result(5, tops),
      main("52525", "77회의 헤드헌팅 내 6성", 6), main("52525", "77회의 헤드헌팅 내 6성", 7),
    ]);
    expect(actions.filter((a) => a.type === "result")).toEqual([{ type: "result", game: "endfield", group: null, count: 10, tops: [6] }]);
    expect(actions.at(-1)).toEqual({ type: "pity", game: "endfield", group: "endfield-chartered", toTop: 77, toFeatured: null });
  });
  it("틀에 안 맞는 글자가 이어지면 '인식 못 함'", () => {
    const { s } = play([main("55025", "6성 확정", 1), main("55025", "6성 확정", 2)]);
    expect(s.status).toMatchObject({ kind: "fail" });
    expect(s.status.message).toContain("toTop");
  });
});
