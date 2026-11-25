// PC판 로그인 도우미 화면: PC 프로그램이 기본 브라우저로 이 주소(?pclogin=<포트>&state=<값>)를 연다.
// 여기서 구글 로그인을 하고, 받은 구글 ID 토큰을 같은 컴퓨터의 PC 프로그램(127.0.0.1:<포트>)으로 넘긴다.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { firebaseConfig } from "./lib/firebase-config";

/** 주소에 로그인 도우미 요청이 있으면 { port, state }, 아니면 null */
export function pcLoginRequest(search: string): { port: number; state: string } | null {
  const q = new URLSearchParams(search);
  const port = Number(q.get("pclogin"));
  const state = q.get("state") ?? "";
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  if (!/^[0-9a-f]{16,64}$/.test(state)) return null;
  return { port, state };
}

export function showPcLogin(target: HTMLElement, req: { port: number; state: string }): void {
  target.innerHTML = `
    <div style="max-width:420px;margin:60px auto;padding:24px;font-family:sans-serif;line-height:1.6;color:#e8e3f5;background:#1b1626;border-radius:12px">
      <h2 style="margin:0 0 8px">황혼 게임즈 PC 로그인</h2>
      <p style="margin:0 0 16px;font-size:14px">구글 계정으로 로그인하면 이 컴퓨터에서 실행 중인 황혼 게임즈 프로그램에 로그인 정보를 넘깁니다.</p>
      <button id="pc-login-go" style="width:100%;padding:12px;font-size:16px;border-radius:8px;border:0;background:#d3bc8e;color:#1b1626;font-weight:700;cursor:pointer">구글로 로그인</button>
      <p id="pc-login-msg" style="margin:12px 0 0;font-size:13px;color:#ffb4a8"></p>
    </div>`;
  document.body.style.background = "#0f0c17";
  const msg = target.querySelector<HTMLElement>("#pc-login-msg")!;
  target.querySelector<HTMLButtonElement>("#pc-login-go")!.onclick = async () => {
    try {
      if (!firebaseConfig) throw new Error("로그인 설정이 없습니다");
      msg.textContent = "";
      const auth = getAuth(initializeApp(firebaseConfig, "pc-login"));
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      const token = GoogleAuthProvider.credentialFromResult(result)?.idToken;
      if (!token) throw new Error("로그인 정보를 받지 못했습니다");
      location.href = `http://127.0.0.1:${req.port}/?state=${req.state}&token=${encodeURIComponent(token)}`;
    } catch (e) {
      const text = String(e instanceof Error ? e.message : e);
      msg.textContent = /unauthorized-domain/.test(text)
        ? "이 주소가 로그인 허용 목록에 없습니다. Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 chlumael.github.io 를 추가해 주세요."
        : `로그인하지 못했습니다: ${text}`;
    }
  };
}
