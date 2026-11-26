import { describe, expect, it } from "vitest";
import { addPulls, observe, type TrackState } from "./validate";
import type { FieldUse } from "./screen-profile";

const top = { type: "toTop" as const };
const cur = { type: "currency" as const, key: "oroberyl" };

function feed(values: number[], use: FieldUse = top, confirm = 2, pullsAt: Record<number, number> = {}) {
  let s: TrackState = {};
  const accepted: (number | string | null)[] = [];
  values.forEach((v, i) => {
    if (pullsAt[i]) s = addPulls(s, "endfield", pullsAt[i]);
    const o = observe(s, "endfield:g:toTop", v, use, confirm, i);
    s = o.state;
    accepted.push(o.accepted);
  });
  return accepted;
}

describe("값 검증", () => {
  it("두 번 연속 같아야 인정", () => {
    expect(feed([53, 53, 53])).toEqual([null, 53, null]);
    expect(feed([53, 54, 53, 53])).toEqual([null, null, null, 53]);
  });
  it("직전 값과 안 맞으면(뽑지 않았는데 줄어듦) 세 번 연속이어야 인정", () => {
    expect(feed([53, 53, 3, 3, 53])).toEqual([null, 53, null, null, null]);
    expect(feed([53, 53, 3, 3, 3])).toEqual([null, 53, null, null, 3]);
  });
  it("결과 화면으로 10회를 셌으면 10 줄어든 값은 바로(두 번) 인정, 최고 등급으로 다시 커진 값도 정상", () => {
    expect(feed([53, 53, 43, 43], top, 2, { 2: 10 })).toEqual([null, 53, null, 43]);
    expect(feed([53, 53, 77, 77], top, 2, { 2: 10 })).toEqual([null, 53, null, 77]);
  });
  it("재화는 수입이 있어 늘어도 의심하지 않는다", () => {
    expect(feed([100, 100, 5000, 5000], cur)).toEqual([null, 100, null, 5000]);
  });
});
