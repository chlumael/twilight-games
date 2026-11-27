// Thin wrapper over Tauri commands. Outside Tauri (plain `vite` preview) it falls
// back to localStorage so the UI can be developed and screenshotted in a browser.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import type { GameId } from "./types";

export const inTauri = isTauri();

/** Bridge injected by the Android app (android/ … WebBridge.kt). */
interface AndroidBridge {
  mode(): "app" | "overlay";
  startOverlay(): void;
  collapse(): void;
  closeOverlay(): void;
  saveFile(name: string, content: string): void;
  /** Overlay only: data for the collapsed one-line bar. Older app versions lack it. */
  updateSummary?(json: string): void;
  appVersion?(): string;
  checkUpdate?(): void;
  /** Native Google account picker; answers via window.__twilightAuth(idToken | null, error?). */
  signIn?(webClientId: string): void;
  signOut?(): void;
  /** 오버레이 전용: 화면 읽기 켜기/끄기. 결과는 window.__twilightScreen(json), __twilightScreenState(json) */
  screenRead?(start: boolean): void;
  screenReading?(): boolean;
  /** 창을 띄울 때 화면 읽기를 함께 시작할지 */
  autoScreenRead?(): boolean;
  setAutoScreenRead?(on: boolean): void;
}
const androidBridge = (window as unknown as { TwilightAndroid?: AndroidBridge }).TwilightAndroid;
export const android = androidBridge ?? null;
/** "app" = full-screen app, "overlay" = floating window over a game, null = not Android. */
export const androidMode = android ? android.mode() : null;

export type StoreName = "records" | "settings" | "banners" | "images";

export async function readStore(name: StoreName): Promise<string | null> {
  if (!inTauri) return localStorage.getItem(`tg-${name}`);
  return invoke<string | null>("read_store", { name });
}

export async function writeStore(name: StoreName, content: string): Promise<void> {
  if (!inTauri) return localStorage.setItem(`tg-${name}`, content);
  await invoke("write_store", { name, content });
}

export async function exportBackup(content: string): Promise<string | null> {
  if (android) {
    android.saveFile(`황혼게임즈-백업-${new Date().toISOString().slice(0, 10)}.json`, content);
    return "android";
  }
  if (!inTauri) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    a.download = "황혼게임즈-백업.json";
    a.click();
    return a.download;
  }
  return invoke<string | null>("export_backup", { content });
}

export async function importBackup(): Promise<string | null> {
  if (!inTauri) {
    // Browser: let the user pick a file.
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null);
      input.click();
    });
  }
  return invoke<string | null>("import_backup");
}

export async function setClickThrough(on: boolean): Promise<void> {
  if (inTauri) await invoke("set_click_through", { on });
}

export async function setProcessMap(map: Record<GameId, string[]>): Promise<void> {
  if (inTauri) await invoke("set_process_map", { map });
}

export async function listProcesses(): Promise<string[]> {
  return inTauri ? invoke<string[]>("list_processes") : [];
}

export async function resizeWindow(width: number, height: number): Promise<void> {
  if (inTauri) await getCurrentWindow().setSize(new LogicalSize(width, height));
}

export interface Detection {
  running: GameId[];
  foreground: GameId | null;
  /** 맨 앞 창의 실행 파일 이름·창 이름(우리 창이 앞이면 그 전 창). 게임이 안 잡힐 때 설정에서 보여 준다 */
  foregroundExe?: string | null;
  foregroundTitle?: string | null;
}

export function onEvent<T>(name: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!inTauri) return Promise.resolve(() => {});
  return listen<T>(name, (e) => handler(e.payload));
}

// ---- 화면 읽기 (안드로이드 오버레이 / PC) ----
/** 이 환경에서 화면 읽기를 쓸 수 있는지 */
export const screenSupported = inTauri || (!!android?.screenRead && androidMode === "overlay");

/** PC: 화면 공유(디스코드 등)에 이 창이 보이게 할지 (사용자 2026-11-27) */
export function setShareVisible(visible: boolean): void {
  if (inTauri) void invoke("set_share_visible", { visible }).catch(() => {});
}

export function screenRead(start: boolean): void {
  if (inTauri) void invoke("screen_read", { start }).catch(() => {});
  else android?.screenRead?.(start);
}

export async function screenReading(): Promise<boolean> {
  if (inTauri) return invoke<boolean>("screen_reading").catch(() => false);
  return !!android?.screenReading?.();
}

/** PC판 구글 로그인: 기본 브라우저를 열고 구글 ID 토큰을 돌려받는다 (src-tauri/src/login.rs). */
export async function googleLoginPc(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let off: UnlistenFn | null = null;
    listen<{ token?: string; error?: string }>("google-token", (e) => {
      off?.();
      if (e.payload.token) resolve(decodeURIComponent(e.payload.token));
      else reject(new Error(e.payload.error || "로그인이 취소되었습니다"));
    }).then((un) => {
      off = un;
      return invoke("google_login");
    }).catch((err) => { off?.(); reject(new Error(String(err))); });
  });
}

/** PC판 버전 (PC가 아니면 null) */
export async function pcVersion(): Promise<string | null> {
  if (!inTauri) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** PC판 새 설치 파일을 기본 브라우저로 내려받는다 */
export async function openPcDownload(): Promise<void> {
  if (inTauri) await invoke("open_download");
}

/** PC판 버튼 하나 업데이트: 설치 파일을 받아 실행하고 프로그램을 끝낸다. 실패하면 이유를 던진다. */
export async function installPcUpdate(): Promise<void> {
  await invoke("install_update");
}

/** PC판 새 화면 인식: 화면 틀(data/screens/*.json)을 넘겨준다. 판단 가능한 화면이 생기면 "screen-regions" 이벤트가 온다 */
export async function setScreenProfiles(profiles: unknown[]): Promise<void> {
  if (inTauri) await invoke("set_screen_profiles", { profiles });
}

/** PC판 원신 기원 기록 불러오기 (src-tauri/src/genshin.rs). stopIds = 기원 종류별 지난번 가장 최근 번호 */
export async function genshinWishes(stopIds: Record<string, string>): Promise<import("./genshin-wish").WishFetch> {
  if (!inTauri) throw new Error("원신 기원 기록 불러오기는 PC판에서만 됩니다");
  return invoke("genshin_wishes", { stopIds });
}
