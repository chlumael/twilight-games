// Thin wrapper over Tauri commands. Outside Tauri (plain `vite` preview) it falls
// back to localStorage so the UI can be developed and screenshotted in a browser.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import type { GameId } from "./types";

export const inTauri = isTauri();

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
  if (!inTauri) return null;
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
