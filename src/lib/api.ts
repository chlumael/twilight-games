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

export type StoreName = "records" | "settings" | "banners";

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
}

export function onEvent<T>(name: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!inTauri) return Promise.resolve(() => {});
  return listen<T>(name, (e) => handler(e.payload));
}

// ---- 화면 읽기 (안드로이드 오버레이 / PC) ----
/** 이 환경에서 화면 읽기를 쓸 수 있는지 */
export const screenSupported = inTauri || (!!android?.screenRead && androidMode === "overlay");

export function screenRead(start: boolean): void {
  if (inTauri) void invoke("screen_read", { start }).catch(() => {});
  else android?.screenRead?.(start);
}

export async function screenReading(): Promise<boolean> {
  if (inTauri) return invoke<boolean>("screen_reading").catch(() => false);
  return !!android?.screenReading?.();
}
