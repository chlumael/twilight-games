import { describe, expect, it } from "vitest";
import { emptyResultState, stepResult } from "./result-count";

const A = ["0000000000000000", "ffffffffffffffff"];
const B = ["ffff0000ffff0000", "0000ffff0000ffff"];

function run(frames: (null | string[])[], start = 0) {
  let s = emptyResultState();
  let counts = 0;
  frames.forEach((p, i) => {
    const r = stepResult(s, { screen: p ? "r10" : null, prints: p ?? [], time: start + i * 1000 });
    s = r.state;
    if (r.count) counts++;
  });
  return counts;
}

describe("결과 화면 세기", () => {
  it("두 프레임 연속 보이면 한 번만 센다", () => {
    expect(run([A])).toBe(0);
    expect(run([A, A, A, A])).toBe(1);
  });
  it("잠깐 가려졌다 같은 화면이 다시 보여도 다시 세지 않는다", () => {
    expect(run([A, A, null, null, null, A, A])).toBe(1);
  });
  it("다른 결과 화면(지문이 다름)은 따로 센다", () => {
    expect(run([A, A, null, null, B, B])).toBe(2);
  });
});
