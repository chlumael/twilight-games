// 화면 인식 틀 (DESIGN.md §4.8). 게임별 화면 정의는 data/screens/*.json에 있고,
// 여기서는 그 틀로 "잘라 읽은 글자"를 해석만 한다. 틀에 안 맞으면 버린다(뜻을 추측하지 않음).
import endfieldProfile from "../../data/screens/endfield.json";
import genshinProfile from "../../data/screens/genshin.json";
import arknightsProfile from "../../data/screens/arknights.json";
import limbusProfile from "../../data/screens/limbus.json";
import type { GameId } from "./types";

/** [x, y, 너비, 높이] — 게임 화면 대비 비율(0~1). null = 아직 스크린샷으로 정하지 않음 */
export type Rect = [number, number, number, number];

/** 화면 판단·등급 판단용 작은 부분: 8×8 밝기 지문(16자리 16진수)과 평균 색 */
export interface Probe {
  rect: Rect | null;
  hash: string | null;
  rgb: [number, number, number] | null;
  /** 지문이 몇 칸까지 달라도 같은 모양으로 보는지 (기본 10/64) */
  maxDistance?: number;
  /** 평균 색 차이 허용치 (R·G·B 차이 합, 기본 40) */
  maxColor?: number;
  note?: string;
}

export type FieldUse =
  | { type: "currency"; key: string; divisor?: number }
  | { type: "toTop" }
  | { type: "toFeatured" }
  | { type: "bannerPulls" }
  | { type: "bannerName" };

export interface FieldDef {
  id: string;
  rect: Rect | null;
  /** digits: 0~9만 남겨 숫자로 / text: 틀(template)에 맞춰 해석 */
  kind: "digits" | "text";
  /** 문구 틀. "{n}" = 숫자 한 덩어리, 공백 무시. 숫자 없이 글자만 받는 칸(배너 이름)은 "{s}" */
  template?: string | null;
  use: FieldUse;
  min: number;
  max: number;
  /** 몇 번 연속 같아야 인정하는지 */
  confirm: number;
  /** 화면에 없을 때도 있는 칸(예: 픽업을 이미 받으면 사라지는 '확정 획득' 줄). 못 읽어도 "인식 못 함"으로 치지 않는다 */
  optional?: boolean;
  /** 숫자 칸 글자 사이 벌리기(글자 높이 대비, PC의 src-tauri/src/ocr.rs). 없으면 0.25, 0이면 벌리지 않음 */
  spacing?: number;
  /** PC: 숫자를 한 글자씩 읽기(윈도우 글자 인식이 통째로 못 읽는 글꼴 — 림버스 광기의 4는 모양으로 알아봄) */
  perGlyph?: boolean;
  note?: string;
}

export interface ScreenDef {
  id: string;
  /** main: 뽑기 화면 / result: 결과 화면 / history: 기록 화면 / signal: 보조 신호 / ignore: 세지 않을 화면 */
  kind: "main" | "result" | "history" | "signal" | "ignore";
  group: string | null;
  /** 결과 화면이 나타내는 뽑기 횟수 */
  pulls?: number;
  /** 이 화면인지 판단하는 작은 부분들(모두 맞아야 함) */
  detect: Probe[];
  /** 결과 화면: 칸마다 "최고 등급일 때의 표시" */
  tops?: Probe[];
  fields: FieldDef[];
  /** 필요한 스크린샷 번호 */
  shot?: string;
  note?: string;
}

export interface GameProfile {
  game: GameId;
  /** 게임 화면의 가로/세로 비율. 창이 이 비율과 다르면 가운데 이 비율 영역을 게임 화면으로 본다. null = 창 전체 */
  aspect: number | null;
  /** 실기에서 확인된 글자 인식 오독 바꿈 표 [틀린 글자, 바른 글자] */
  fixes: [string, string][];
  screens: ScreenDef[];
}

export const PROFILES: GameProfile[] = [endfieldProfile, genshinProfile, arknightsProfile, limbusProfile] as unknown as GameProfile[];

export function profileOf(game: GameId, profiles: GameProfile[] = PROFILES): GameProfile | undefined {
  return profiles.find((p) => p.game === game);
}

export function findScreen(id: string, profiles: GameProfile[] = PROFILES): { profile: GameProfile; screen: ScreenDef } | null {
  for (const profile of profiles) {
    const screen = profile.screens.find((s) => s.id === id);
    if (screen) return { profile, screen };
  }
  return null;
}

const probeReady = (p: Probe) => !!p.rect && !!p.hash && !!p.rgb;
const fieldReady = (f: FieldDef) => !!f.rect && (f.kind === "digits" || !!f.template);

/** 화면 판단이 가능한지(판단 부분이 모두 정해졌는지) */
export function detectReady(s: ScreenDef): boolean {
  return s.detect.length > 0 && s.detect.every(probeReady);
}

/** 화면이 완전히 정해졌는지: 판단 부분 + 읽을 칸 + (결과 화면이면) 등급 표시 */
export function screenReady(s: ScreenDef): boolean {
  return detectReady(s) && s.fields.every(fieldReady) && (s.kind !== "result" || (!!s.tops?.length && s.tops.every(probeReady)));
}

/** 이 게임에서 결과 화면으로 횟수를 세는지 (그러면 재화 차이로는 뽑기를 기록하지 않는다 — 두 번 세지 않게) */
export function resultCountingReady(game: GameId, profiles: GameProfile[] = PROFILES): boolean {
  const p = profileOf(game, profiles);
  return !!p && p.screens.some((s) => s.kind === "result" && screenReady(s));
}

/** 새 방식이 하나라도 켜졌는지 (판단 가능한 화면이 있는지) */
export function anyReady(profiles: GameProfile[] = PROFILES): boolean {
  return profiles.some((p) => p.screens.some(detectReady));
}

export interface Gap {
  game: GameId;
  screen: string;
  shot: string;
  missing: string[];
}

/** 비어 있는 곳 목록 (docs/recognition-gaps.md와 같은 내용을 코드에서 뽑을 때) */
export function profileGaps(profiles: GameProfile[] = PROFILES): Gap[] {
  const out: Gap[] = [];
  for (const p of profiles) {
    for (const s of p.screens) {
      const missing: string[] = [];
      s.detect.forEach((d, i) => { if (!probeReady(d)) missing.push(`화면 판단 ${i + 1}: ${d.note ?? ""}`.trim()); });
      for (const f of s.fields) {
        if (!f.rect) missing.push(`위치: ${f.id} (${f.note ?? ""})`);
        if (f.kind === "text" && !f.template) missing.push(`문구 틀: ${f.id}`);
      }
      const tops = s.tops ?? [];
      const missingTops = tops.filter((t) => !probeReady(t)).length;
      if (missingTops) missing.push(`등급 표시 ${missingTops}칸`);
      if (missing.length) out.push({ game: p.game, screen: s.id, shot: s.shot ?? "", missing });
    }
  }
  return out;
}

/** 실기에서 확인된 오독만 고친다 (짐작으로 고치지 않음) */
export function applyFixes(text: string, fixes: [string, string][]): string {
  let t = text;
  for (const [from, to] of fixes) t = t.split(from).join(to);
  return t;
}

const squash = (s: string) => s.replace(/\s+/g, "");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 숫자 칸: 0~9 외 글자를 버린다. 숫자가 없으면 null */
export function readDigits(text: string): number | null {
  // 숫자 덩어리 바로 앞뒤에 글자가 붙어 있으면 숫자를 글자로 잘못 읽은 것(예: 58414 → "S8414") → 못 읽은 것으로 본다
  // (글자를 버리고 "8414"로 읽으면 틀린 값이 들어간다, PC 실기 2026-11-27 림버스 광기)
  const m = text.match(/[0-9][0-9,.\s]*[0-9]|[0-9]/);
  if (!m) return null;
  // 띄어 쓴 글자는 괜찮다: 칸 옆 구분선이 "l"·"I"로 읽혀 "l 8390"이 되는 일이 있다(그때 숫자는 맞다)
  const before = text.slice(0, m.index).slice(-1);
  const after = text.slice(m.index! + m[0].length).slice(0, 1);
  if (/[A-Za-z가-힣]/.test(before) || /[A-Za-z가-힣]/.test(after)) return null;
  const d = m[0].replace(/[^0-9]/g, "");
  if (!d || d.length > 9) return null;
  return Number(d);
}

/**
 * 문구 틀에 맞춰 값을 꺼낸다. 공백은 무시하고, 틀의 글자와 정확히 같아야 한다.
 * "{n}" = 숫자 한 덩어리(결과는 number), "{s}" = 아무 글자(결과는 string). 틀에 안 맞으면 null.
 * 틀 앞뒤에 다른 글자가 붙은 것은 허용한다(잘라 읽은 영역에 장식 글자가 끼는 경우).
 */
export function matchTemplate(text: string, template: string): number | string | null {
  const parts = squash(template).split(/(\{n\}|\{s\})/);
  let re = "";
  let kind: "n" | "s" | null = null;
  for (const part of parts) {
    if (part === "{n}") { re += "(\\d{1,6})"; kind = "n"; }
    else if (part === "{s}") { re += "(.+?)"; kind = "s"; }
    else re += escape(part);
  }
  const m = squash(text).match(new RegExp(kind === "s" ? `^${re}$` : re));
  if (!m) return null;
  if (kind === "n") return Number(m[1]);
  if (kind === "s") return m[1];
  return "";
}

export type FieldResult =
  | { id: string; ok: true; value: number | string; use: FieldUse }
  | { id: string; ok: false; reason: "빈칸" | "읽지 못함" | "틀 불일치" | "범위 밖"; text: string };

/** 잘라 읽은 글자 하나를 칸 정의로 해석한다 */
export function parseField(field: FieldDef, raw: string | undefined, fixes: [string, string][]): FieldResult {
  if (!field.rect || (field.kind === "text" && !field.template)) return { id: field.id, ok: false, reason: "빈칸", text: raw ?? "" };
  const text = applyFixes(raw ?? "", fixes);
  if (!text.trim()) return { id: field.id, ok: false, reason: "읽지 못함", text };
  if (field.kind === "digits") {
    const n = readDigits(text);
    if (n === null) return { id: field.id, ok: false, reason: "읽지 못함", text };
    const divisor = field.use.type === "currency" ? field.use.divisor : undefined;
    // 환산 칸(예: 75의 배수)이 나눠떨어지지 않으면 잘못 읽은 것
    if (divisor && n % divisor !== 0) return { id: field.id, ok: false, reason: "범위 밖", text };
    const v = divisor ? n / divisor : n;
    if (n < field.min || n > field.max) return { id: field.id, ok: false, reason: "범위 밖", text };
    return { id: field.id, ok: true, value: v, use: field.use };
  }
  const v = matchTemplate(text, field.template!);
  if (v === null) return { id: field.id, ok: false, reason: "틀 불일치", text };
  if (typeof v === "number" && (v < field.min || v > field.max)) return { id: field.id, ok: false, reason: "범위 밖", text };
  return { id: field.id, ok: true, value: v, use: field.use };
}
