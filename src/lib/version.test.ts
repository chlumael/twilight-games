import { describe, expect, it } from "vitest";
import { isNewer, parseVersion } from "./version";

describe("버전 비교", () => {
  it("숫자로 비교한다", () => {
    expect(isNewer("v0.7.3", "0.7.2")).toBe(true);
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("0.7.2", "0.7.2")).toBe(false);
    expect(isNewer("0.7.1", "0.7.2")).toBe(false);
    expect(isNewer("1.0", "0.9.9")).toBe(true);
  });
  it("읽을 수 없는 값은 새 버전으로 보지 않는다", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(isNewer("latest", "0.7.2")).toBe(false);
  });
});
