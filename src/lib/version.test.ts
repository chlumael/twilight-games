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

describe("PC판 업데이트 알림 (같은 버전 번호의 고친 설치 파일도, 사용자 2026-11-27)", async () => {
  const { pcUpdateKind } = await import("./version");
  const built = "2026-11-27T06:00:00Z";
  const rel = (version: string, pcUpdatedAt: string | null, hasPc = true) => ({ version, hasPc, pcUpdatedAt });
  it("새 번호면 new(설치 파일이 아직이면 wait)", () => {
    expect(pcUpdateKind(rel("0.9.18", "2026-11-27T05:00:00Z"), "0.9.17", built)).toBe("new");
    expect(pcUpdateKind(rel("0.9.18", null, false), "0.9.17", built)).toBe("wait");
  });
  it("같은 번호: 설치 파일이 이 프로그램보다 15분 넘게 뒤에 올라왔으면 fix, 아니면 최신", () => {
    expect(pcUpdateKind(rel("0.9.17", "2026-11-27T07:00:00Z"), "0.9.17", built)).toBe("fix");
    expect(pcUpdateKind(rel("0.9.17", "2026-11-27T06:10:00Z"), "0.9.17", built)).toBe("latest");
    expect(pcUpdateKind(rel("0.9.17", null), "0.9.17", built)).toBe("latest");
  });
  it("확인 못 하면 fail", () => {
    expect(pcUpdateKind(null, "0.9.17", built)).toBe("fail");
  });
});
