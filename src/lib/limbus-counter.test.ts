import { describe, expect, it } from "vitest";
import { counterStep, emptyCounterState, limbusBannerOnScreen } from "./limbus-counter";
import type { PackBanner } from "./banners";

const B = (id: string, end: string, featured: string[]): PackBanner => ({
  id, group: "limbus-extraction", name: id, start: "2026-11-26T03:00:00.000Z", end, version: null,
  featured: featured.map((ko) => ({ id: `ko:${ko}`, ko })), featuredRare: [],
});

describe("림버스 이상 N/200으로 뽑기 세기", () => {
  it("두 번 연속 같아야 확정, 처음 본 값은 기준만, 오른 만큼 센다(연달아 뽑고 나중에 한 번 나와도)", () => {
    let s = emptyCounterState();
    let r = counterStep(s, "b", 10); s = r.state; expect(r.add).toBe(0);
    r = counterStep(s, "b", 10); s = r.state; expect(r).toMatchObject({ add: 0, first: 10 });
    // 결과 화면에서 10뽑 3번 → 메인으로 나와 40
    r = counterStep(s, "b", 40); s = r.state; expect(r.add).toBe(0); // 한 번 읽은 것은 아직
    r = counterStep(s, "b", 40); s = r.state; expect(r).toMatchObject({ add: 30, from: 10 });
    r = counterStep(s, "b", 40); s = r.state; expect(r.add).toBe(0); // 같은 값은 다시 안 셈
  });
  it("한 번만 잘못 읽힌 값은 무시", () => {
    let s = emptyCounterState();
    for (const v of [10, 10]) s = counterStep(s, "b", v).state;
    let r = counterStep(s, "b", 110); s = r.state; expect(r.add).toBe(0); // 오독 한 번
    r = counterStep(s, "b", 10); s = r.state; expect(r.add).toBe(0);
    r = counterStep(s, "b", 10); s = r.state; expect(r.add).toBe(0);
  });
  it("줄었으면 200 교환 + 그 사이 뽑기 (190 → 10뽑 → 교환 → 0 = 10회, 교환만 하면 0회)", () => {
    let s = emptyCounterState();
    for (const v of [190, 190]) s = counterStep(s, "b", v).state;
    let r = counterStep(s, "b", 0); s = r.state;
    r = counterStep(s, "b", 0); s = r.state;
    expect(r).toMatchObject({ add: 10, exchanged: true, from: 190 });
    for (const v of [205, 205]) { r = counterStep(s, "b", v); s = r.state; }
    for (const v of [5, 5]) { r = counterStep(s, "b", v); s = r.state; }
    expect(r).toMatchObject({ add: 0, exchanged: true });
  });
  it("배너마다 따로", () => {
    let s = emptyCounterState();
    for (const v of [10, 10]) s = counterStep(s, "a", v).state;
    let r = counterStep(s, "b", 3); s = r.state;
    r = counterStep(s, "b", 3); s = r.state;
    expect(r).toMatchObject({ add: 0, first: 3 });
  });
});

describe("화면의 배너 알아내기", () => {
  const banners = [
    B("pick", "2026-12-10T01:00:00.000Z", ["오트쿠튀르::르루주 B2F 타래둥지 그레고르", "오트쿠튀르::르누아르 B3F 건조장 이상"]),
    B("rerun", "2026-12-17T01:00:00.000Z", ["오트쿠튀르::수선실 로쟈"]),
  ];
  it("종료일(한국 시간)과 오른쪽 수감자 이름으로", () => {
    expect(limbusBannerOnScreen({ until: "2026.12.10 10:00 [KST] 까지", sinner: "그레고르" }, banners)?.id).toBe("pick");
    expect(limbusBannerOnScreen({ until: "2026.12.10 10:00 [KST] 까지", sinner: null }, banners)?.id).toBe("pick");
    expect(limbusBannerOnScreen({ until: "2026.12.10 10:00 [KST] 까지", sinner: "로쟈" }, banners)).toBeNull();
    expect(limbusBannerOnScreen({ until: null, sinner: "그레고르" }, banners)).toBeNull();
  });
});
