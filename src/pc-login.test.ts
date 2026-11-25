import { describe, expect, it } from "vitest";

// pc-login.ts는 firebase를 불러오므로 주소 해석만 따로 검사한다
import { pcLoginRequest } from "./pc-login";

describe("PC 로그인 도우미 주소", () => {
  it("포트와 state가 올바를 때만 받아들인다", () => {
    expect(pcLoginRequest("?pclogin=51234&state=0123456789abcdef0123456789abcdef")).toEqual({ port: 51234, state: "0123456789abcdef0123456789abcdef" });
    expect(pcLoginRequest("?pclogin=80&state=0123456789abcdef")).toBeNull();
    expect(pcLoginRequest("?pclogin=51234&state=<script>")).toBeNull();
    expect(pcLoginRequest("?pclogin=abc&state=0123456789abcdef")).toBeNull();
    expect(pcLoginRequest("")).toBeNull();
  });
});
