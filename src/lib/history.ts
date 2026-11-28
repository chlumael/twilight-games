// 공식 기록 화면 읽기: 게임 안(또는 공식 웹) 뽑기 기록 화면의 글자를 줄 단위 기록으로 바꾸고,
// 앱 기록에 반영한다. 공식 기록은 화면 인식·수동 입력보다 우선한다(CLAUDE.md 원칙).
// 엔드필드 "헤드헌팅 기록", 원신 "기원 기록", 명일방주 요스타 계정 사이트 (사용자 실기 자료 2026-11-25).
// 림버스 "추출 이력"은 최근 15일 20건만, 시각 없이 보여서 기록 반영 대상에서 뺐다.
import type { PackBanner } from "./banners";
import type { ScreenFrame, ScreenLine } from "./recognize";
import type { GameId, Pull, Records } from "./types";

export interface HistoryRow {
  /** 배너 이름 (예: "은하수를 부르는 불꽃") */
  banner: string;
  name: string;
  /** ISO 시각 */
  time: string;
  /** 긴급 모집(무료 10회): 천장·누적 횟수에 들어가지 않는다 */
  emergency: boolean;
  /** 화면에서 바로 알 수 있는 종류(원신 기원 유형). 없으면 배너 이름으로 찾는다 */
  group?: string | null;
  /** 화면에서 바로 알 수 있는 등급(원신 "이름(4)"). 없으면 이름 목록으로 판단 */
  rarity?: number | null;
  /** 쪽 안의 줄 자리(세로 위치 ×100). 있으면 같은 쪽·같은 자리는 한 줄로 보고 여러 번 읽은 것 중 많이 나온 것을 쓴다(mergePages) */
  slot?: number;
  /** 이름 칸을 따로 다시 읽은 두 번째 후보(PC). 아는 이름 목록으로 name과 둘 중 하나를 고른다 */
  altName?: string;
  /** 같은 자리를 읽은 결과별 횟수(다수결용, mergePages가 채움) */
  votes?: Record<string, number>;
  /** 같은 자리를 읽은 결과들(다수결로 고를 후보) */
  alts?: Record<string, HistoryRow>;
}

export interface HistoryPage {
  game: GameId;
  page: number | null;
  rows: HistoryRow[];
}

/** OCR이 숫자를 글자로 읽은 것 고치기 (1l → 11, O → 0) */
const digits = (s: string) => s.replace(/[lI|]/g, "1").replace(/[Oo]/g, "0");

/** "2026. 11. 07 07:49:25" (+ 시간대) → ISO */
export function parseRecordTime(text: string, utcOffset: number): string | null {
  const t = digits(text);
  const m = t.match(/(\d{4})\s*[.,]\s*(\d{1,2})\s*[.,]\s*(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  const date = m ? null : t.match(/(\d{4})\s*[.,]\s*(\d{1,2})\s*[.,]\s*(\d{1,2})\s+(\S+)/);
  const clock = date ? looseClock(date[4]) : null;
  if (!m && !clock) return null;
  const [y, mo, d, h, mi, s] = m ? m.slice(1).map(Number) : [...date!.slice(1, 4).map(Number), ...clock!];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return new Date(Date.UTC(y, mo - 1, d, h - utcOffset, mi, s)).toISOString();
}

/**
 * 콜론이 빠지거나 다른 글자로 읽힌 시각 "hh:mm:ss" → [시, 분, 초]. PC 윈도우 글자 인식(엔드필드 기록 화면, 2026-11-28 실기)은
 * "06:11:41"을 "061141"·"0611141"·"05141109"·"05!41!06"처럼 읽었다. 콜론 자리(2·5번째, 하나가 빠졌으면 2 또는 4번째)는
 * 숫자가 아니거나 "1"이어야 하고, 어느 자리가 콜론인지에 따라 값이 달라지면(애매하면) 버린다.
 */
function looseClock(raw: string): [number, number, number] | null {
  const sep = (c: string) => !/\d/.test(c) || c === "1";
  const ok = (s: string): [number, number, number] | null => {
    if (!/^\d{6}$/.test(s)) return null;
    const v: [number, number, number] = [Number(s.slice(0, 2)), Number(s.slice(2, 4)), Number(s.slice(4))];
    return v[0] <= 23 && v[1] <= 59 && v[2] <= 59 ? v : null;
  };
  if (raw.length === 6) return ok(raw);
  if (raw.length === 8) return sep(raw[2]) && sep(raw[5]) ? ok(raw.slice(0, 2) + raw.slice(3, 5) + raw.slice(6)) : null;
  if (raw.length === 7) {
    const tries = [2, 4].filter((i) => sep(raw[i])).map((i) => ok(raw.slice(0, i) + raw.slice(i + 1))).filter((v): v is [number, number, number] => !!v);
    const same = tries.every((v) => v.join() === tries[0]?.join());
    return tries.length && same ? tries[0] : null;
  }
  return null;
}

/**
 * 한 글자 틀리게 읽힌 이름을 아는 이름으로 바로잡는다(PC 실기 2026-11-28: "케르" → "케로").
 * 아는 이름에 그대로 있으면 그대로, 길이가 같고 한 글자만 다른 이름이 딱 하나면 그 이름. 둘 이상이거나 없으면 그대로 둔다.
 */
export function fixKnownName(name: string, known: Iterable<string>): string {
  const t = name.replace(/\s+/g, "");
  const list = [...new Set([...known].filter(Boolean))];
  if (list.some((k) => k.replace(/\s+/g, "") === t)) return name;
  const chars = [...t];
  const hits = list.filter((k) => {
    const kc = [...k.replace(/\s+/g, "")];
    return kc.length === chars.length && chars.length >= 2 && kc.filter((c, i) => c !== chars[i]).length === 1;
  });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return name;
  // 자모로 나눠 가장 가까운 아는 이름(글자 수 같고, 차이 2 이하, 두 번째로 가까운 이름보다 1 이상 가까울 때만).
  // 글자 인식이 자주 헷갈리는 차이(받침이 빠짐·생김, ㄷ↔ㅌ 같은 비슷한 자모)는 0.5로 센다.
  // PC 실기 2026-11-28: "안탈"을 두 방법 모두 "아다"로 읽음 → 안탈 1.5, 용사 2.5, 카뮤 3
  const jt = jamo(t);
  const scored = list
    .filter((k) => [...k.replace(/\s+/g, "")].length === chars.length && chars.length >= 2)
    .map((k) => ({ k, d: editDistance(jt, jamo(k.replace(/\s+/g, ""))) }))
    .sort((a, b) => a.d - b.d);
  if (scored.length && scored[0].d <= 2 && (scored.length === 1 || scored[1].d >= scored[0].d + 1)) return scored[0].k;
  return name;
}

/** 모양이 비슷해 글자 인식이 헷갈리는 자모 짝(초성 c, 중성 v 번호) */
const LOOKALIKE = new Set(["c3|c16", "c0|c15", "c7|c17", "c12|c14", "c9|c10", "c0|c1", "c3|c4", "c7|c8", "c12|c13", "v0|v2", "v0|v1", "v4|v6", "v4|v5", "v8|v12", "v13|v17", "v18|v20"]);
function swapCost(a: string, b: string): number {
  if (a === b) return 0;
  if (a[0] !== b[0]) return 1.5;
  return LOOKALIKE.has(`${a}|${b}`) || LOOKALIKE.has(`${b}|${a}`) ? 0.5 : 1;
}
/** 받침(j)은 빠지거나 생겨도 0.5 */
const gapCost = (x: string) => (x[0] === "j" ? 0.5 : 1);

/** 한글 음절을 자모(초성·중성·종성)로 나눈다. 한글이 아닌 글자는 그대로 */
function jamo(s: string): string[] {
  const out: string[] = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) { out.push(ch); continue; }
    out.push(`c${Math.floor(c / 588)}`, `v${Math.floor((c % 588) / 28)}`);
    if (c % 28) out.push(`j${c % 28}`);
  }
  return out;
}

function editDistance(a: string[], b: string[]): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) d[i][0] = d[i - 1][0] + gapCost(a[i - 1]);
  for (let j = 1; j <= b.length; j++) d[0][j] = d[0][j - 1] + gapCost(b[j - 1]);
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + gapCost(a[i - 1]), d[i][j - 1] + gapCost(b[j - 1]), d[i - 1][j - 1] + swapCost(a[i - 1], b[j - 1]));
  }
  return d[a.length][b.length];
}

/**
 * 엔드필드 기록 줄의 이름 고르기: 화면 전체 읽기(name)와 칸 다시 읽기(altName) 중 아는 이름 목록에 있는 쪽.
 * 둘 다 없으면 한 글자 틀린 이름 바로잡기(fixKnownName)를 거친 name. 6성 이름으로 바꾸는 것은 "(6★)"가 함께 읽혔을 때만.
 */
export function chooseName(row: HistoryRow, known: string[], six: string[]): string {
  const fix = (c: string) => {
    const f = fixKnownName(c, known);
    return six.includes(f) && f !== c && row.rarity !== 6 ? c : f;
  };
  const cands = [row.name, row.altName].filter((c): c is string => !!c && /[가-힣]/.test(c)).map(fix);
  return cands.find((c) => known.includes(c)) ?? cands[0] ?? row.name;
}

/** 이름 칸 정리: "NEW!" 떼기, "(6★)"·"(6*)"는 등급으로 (PC 실기 2026-11-28: "NEW! 케르 (6*)") */
function cleanName(raw: string): { name: string; rarity: number | null } {
  const r = raw.match(/\(\s*(\d)\s*[*★☆]?\s*\)/);
  // "NEW!"는 "NEWI"·"NEW1"처럼도 읽혔다(PC 실기 2026-11-28)
  const name = raw.replace(/\(\s*\d\s*[*★☆]?\s*\)/, "").replace(/NEW[!I1l|]?/gi, "").replace(/^[^가-힣A-Za-z]+/, "").trim();
  return { name, rarity: r ? Number(r[1]) : null };
}

const near = (a: ScreenLine, b: ScreenLine) => Math.abs(a.y - b.y) < 0.02;

/** 엔드필드 헤드헌팅 기록 화면 → 기록 줄 (화면이 아니면 null) */
export function parseEndfieldHistory(frame: ScreenFrame): HistoryPage | null {
  const lines = frame.lines;
  if (!lines.some((l) => /헤드헌팅\s*기록/.test(l.t))) return null;
  const header = lines.find((l) => /시간\s*\(\s*UTC/.test(l.t));
  if (!header) return null;
  const tz = Number(header.t.match(/UTC\s*([+-]\s*\d+)/)?.[1].replace(/\s/g, "") ?? 8);
  const rows: HistoryRow[] = [];
  const timeLines = lines
    .filter((l) => l.x > header.x - 0.06 && l.y > header.y + 0.02)
    .map((l) => ({ l, time: parseRecordTime(l.t, tz) }))
    .filter((v): v is { l: ScreenLine; time: string } => !!v.time)
    .sort((a, b) => a.l.y - b.l.y);
  for (const { l, time } of timeLines) {
    const banner = lines.find((b) => b !== l && near(b, l) && b.x > 0.25 && b.x < 0.5 && /[가-힣]/.test(b.t));
    // 이름 칸에 같은 줄로 읽힌 조각을 모두 이어 붙인다: 6성 줄은 "NEW!" 표시와 이름·"(6★)"이 따로 읽혔다
    // (PC 실기 2026-11-28: "NEW!"만 집어 이름이 빈칸이 되고 6성을 놓침 → 천장 73으로 보임)
    const cell = lines.filter((n) => n !== l && near(n, l) && n.x >= 0.5 && n.x < header.x - 0.02).sort((a, b) => a.x - b.x);
    // "※"로 시작하는 조각은 앱(PC)이 이름 칸을 따로 다시 읽은 두 번째 후보 — 아는 이름 목록으로 고른다(flows/screen.svelte.ts)
    const alt = cell.find((n) => n.t.startsWith("※"))?.t.slice(1);
    const parts = cell.filter((n) => !n.t.startsWith("※"));
    const name = parts.length && parts.some((n) => /[가-힣]/.test(n.t)) ? { t: parts.map((n) => n.t).join(" ") } : null;
    if (!banner || !name) continue;
    // "헤드헌팅 정보서-<배너>" 줄은 60회 보상(다음 한정 10회 허가증)이지 뽑기가 아니다(PC 실기 2026-11-28, 13쪽)
    if (/정보서/.test(name.t) || /정보서/.test(banner.t)) continue;
    const emergency = /긴급\s*모집/.test(banner.t);
    const nm = cleanName(name.t);
    rows.push({
      banner: banner.t.replace(/^.*긴급\s*모집\s*[-–]\s*/, "").trim(),
      name: nm.name,
      time,
      emergency,
      ...(nm.rarity ? { rarity: nm.rarity } : {}),
      ...(alt ? { altName: cleanName(alt).name } : {}),
      slot: Math.round(l.y * 100),
    });
  }
  const prev = lines.find((l) => /^이전$/.test(l.t.trim()));
  const pageLine = prev ? lines.find((l) => /^\d{1,3}$/.test(l.t.trim()) && Math.abs(l.y - prev.y) < 0.03) : undefined;
  return { game: "endfield", page: pageLine ? Number(pageLine.t.trim()) : null, rows };
}

const nearY = (a: ScreenLine, b: ScreenLine, d = 0.025) => Math.abs(a.y - b.y) < d;
const tzOf = (text: string | undefined, fallback: number) =>
  Number(text?.match(/UTC\s*([+-]\s*\d+)/)?.[1].replace(/\s/g, "") ?? fallback);

/** 원신 기원 유형 → 종류. 상시·초심자 기원은 다루지 않아 null */
export function genshinGroup(kind: string): string | null {
  if (/캐릭터\s*이벤트/.test(kind)) return "genshin-char";
  if (/무기/.test(kind)) return "genshin-weapon";
  if (/집록|묶음/.test(kind)) return "genshin-chronicled"; // 공식 한국어 이름은 「묶음 기원」
  return null;
}

/**
 * 원신 기원 기록 화면 → 기록 줄. 열: 아이템 유형 / 아이템 이름(4성·5성은 "이름(4)") / 기원 유형 / 뽑기 시간.
 * 시각은 서버 시간이라 아시아 서버(UTC+8)로 본다(한국 사용자 기준, 추정).
 */
export function parseGenshinHistory(frame: ScreenFrame, rarityOf: (name: string) => number | null): HistoryPage | null {
  const lines = frame.lines;
  const nameHead = lines.find((l) => /아이템\s*이름/.test(l.t));
  const timeHead = lines.find((l) => /뽑기\s*시간/.test(l.t));
  const kindHead = lines.find((l) => /기원\s*유형/.test(l.t) && l.y > (nameHead?.y ?? 1) - 0.02);
  if (!nameHead || !timeHead || !kindHead) return null;
  const rows: HistoryRow[] = [];
  const times = lines
    .filter((l) => l.y > timeHead.y + 0.02 && Math.abs(l.x - timeHead.x) < 0.1)
    .map((l) => ({ l, time: parseRecordTime(l.t.replace(/-/g, "."), 8) }))
    .filter((v): v is { l: ScreenLine; time: string } => !!v.time)
    .sort((a, b) => a.l.y - b.l.y);
  for (const { l, time } of times) {
    const nameLine = lines.find((n) => nearY(n, l) && Math.abs(n.x - nameHead.x) < 0.06 && /[가-힣]/.test(n.t));
    const kindLine = lines.find((k) => nearY(k, l) && Math.abs(k.x - kindHead.x) < 0.08 && /기원/.test(k.t));
    if (!nameLine || !kindLine) continue;
    const m = nameLine.t.trim().match(/^(.*?)\s*\((\d)\)$/);
    const name = (m ? m[1] : nameLine.t).trim();
    rows.push({
      banner: kindLine.t.trim(),
      name,
      time,
      emergency: false,
      group: genshinGroup(kindLine.t),
      rarity: m ? Number(m[2]) : (rarityOf(name) ?? 3),
    });
  }
  const pageLine = lines.find((l) => /^\d{1,3}$/.test(l.t.trim()) && l.y > (times.at(-1)?.l.y ?? 0.7) && l.x > 0.4 && l.x < 0.6);
  return { game: "genshin", page: pageLine ? Number(pageLine.t.trim()) : null, rows };
}

/**
 * 명일방주 요스타 계정 사이트의 가챠 기록 → 기록 줄. 열: 배너 / 획득 결과(이름) / 획득 시간(날짜 줄 + 시각 줄).
 * 등급은 글자로 안 나와서 6성 이름 목록으로 판단한다.
 */
export function parseArknightsHistory(frame: ScreenFrame): HistoryPage | null {
  const lines = frame.lines;
  const result = lines.find((l) => /획득\s*결과/.test(l.t));
  const timeHead = lines.find((l) => /획득\s*시간/.test(l.t));
  if (!result || !timeHead) return null;
  const tz = tzOf(timeHead.t, 9);
  const rows: HistoryRow[] = [];
  const dates = lines.filter((l) => l.y > timeHead.y && /^\d{4}-\d{2}-\d{2}$/.test(digits(l.t.trim()))).sort((a, b) => a.y - b.y);
  for (const d of dates) {
    const clock = lines.find((c) => c.y >= d.y && c.y - d.y < 0.035 && Math.abs(c.x - d.x) < 0.08 && /^\d{2}:\d{2}:\d{2}$/.test(digits(c.t.trim())));
    if (!clock) continue;
    const time = parseRecordTime(`${digits(d.t.trim()).replace(/-/g, ".")} ${digits(clock.t.trim())}`, tz);
    const band = (l: ScreenLine) => l.y > d.y - 0.02 && l.y < clock.y + 0.02;
    const banner = lines.find((b) => band(b) && b.x < result.x - 0.1 && /[가-힣]/.test(b.t));
    const name = lines.find((n) => band(n) && Math.abs(n.x - result.x) < 0.08 && /[가-힣]/.test(n.t));
    if (!time || !banner || !name) continue;
    rows.push({ banner: banner.t.trim(), name: name.t.trim(), time, emergency: false });
  }
  return { game: "arknights", page: null, rows };
}

/** 여러 화면(쪽)에서 읽은 줄을 합친다. 같은 쪽을 여러 번 읽어도 한 번만 남는다. */
export function mergePages(store: Record<string, HistoryRow>, page: HistoryPage): Record<string, HistoryRow> {
  const next = { ...store };
  const seen = new Map<string, number>();
  for (const r of page.rows) {
    // 줄 자리를 알면: 같은 쪽·같은 자리는 한 줄. 읽을 때마다 결과를 세어 가장 많이 나온 것을 쓴다
    // (PC 실기 2026-11-28: 한 번 "판"을 "아다"로 읽은 것이 따로 한 줄로 쌓여 기록이 섞였다)
    if (r.slot != null && page.page != null) {
      // 위치가 1~2 차이 나게 읽힐 수 있어 가까운 자리를 같은 자리로 본다
      const near = [r.slot, r.slot - 1, r.slot + 1, r.slot - 2, r.slot + 2].map((s) => `${page.page}|@${s}`).find((k) => k in next);
      const key = near ?? `${page.page}|@${r.slot}`;
      const old = next[key];
      const sig = `${r.time}|${r.banner}|${r.name}|${r.emergency}|${r.rarity ?? ""}`;
      const votes = { ...(old?.votes ?? {}), [sig]: (old?.votes?.[sig] ?? 0) + 1 };
      const { votes: _v, alts: _a, ...plain } = r;
      const alts = { ...(old?.alts ?? {}), [sig]: plain };
      const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
      next[key] = { ...alts[best], votes, alts };
      continue;
    }
    const base = `${page.page ?? "?"}|${r.time}|${r.banner}|${r.name}|${r.emergency}`;
    const k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    next[`${base}|${k}`] = r;
  }
  return next;
}

/** 읽어 둔 기록 쪽 번호 사이에 빠진 쪽 (예: 1, 2, 4쪽을 읽었으면 [3]). 쪽 번호를 모르는 화면은 따지지 않는다 */
export function missingPages(store: Record<string, HistoryRow>): number[] {
  const pages = [...new Set(Object.keys(store).map((k) => Number(k.split("|")[0])).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 1; i < pages.length; i++) for (let n = pages[i - 1] + 1; n < pages[i]; n++) out.push(n);
  return out;
}

export interface ImportResult {
  records: Records;
  added: number;
  replaced: number;
  skipped: number;
}

/**
 * 공식 기록을 앱 기록에 반영한다.
 * - 종류: 줄에 적힌 종류(원신) → 없으면 groupOf(배너 이름). 못 찾으면(상시·커널 등) 건너뛴다.
 * - 긴급 모집은 천장·누적 횟수에 안 들어가므로 넣지 않는다.
 * - 기록이 덮는 시간 구간 안의 기존 뽑기(화면 감지·수동)는 공식 기록으로 바꾼다.
 */
/** 화면 감지 기록이 실제 뽑은 시각보다 늦게 찍힐 수 있는 최대 시간 */
export const SCREEN_LAG_MS = 15 * 60 * 1000;

export function importHistory(
  records: Records,
  game: GameId,
  rows: HistoryRow[],
  ctx: {
    banners: PackBanner[];
    /** 최고 등급 (원신 5, 그 외 6) */
    topRarity: number;
    /** 이름으로 최고 등급인지 (등급이 화면에 없을 때) */
    isTop: (name: string) => boolean;
    /** 배너 이름 → 종류. null이면 제외 */
    groupOf?: (banner: string) => string | null;
    /** 이 등급보다 낮으면 이름·등급을 남기지 않는다 (원신 3성 — 사용자 요청) */
    minNamedRarity?: number;
    /** 픽업 판정을 따로 할 때 (원신 기원 기록: 동시에 열린 기원들을 함께 본다) */
    featuredOf?: (row: HistoryRow, group: string) => boolean | null;
    /** 같은 종류의 직접 입력 기록(공식 기록 구간 시작 이후에 넣은 것)을 지우고 공식 기록으로 바꾼다 — 두 번 세지 않게 */
    replaceManual?: boolean;
    newId: () => string;
  },
): ImportResult {
  const next = structuredClone(records);
  const rec = next.games[game];
  const byName = (name: string) => ctx.banners.find((b) => b.name.includes(`「${name}」`) || b.name === name);
  const groupFor = (r: HistoryRow) => r.group ?? byName(r.banner)?.group ?? ctx.groupOf?.(r.banner) ?? null;
  // 배너 ID: 이름이 맞는 배너 → 그 시각에 진행 중이던 같은 종류 배너 → 없으면 빈칸
  const bannerFor = (r: HistoryRow, group: string) =>
    byName(r.banner) ??
    ctx.banners.find((b) => b.group === group && b.start && b.start <= r.time && (!b.end || r.time <= b.end));
  const usable = rows
    .filter((r) => !r.emergency)
    .map((r) => ({ r, group: groupFor(r) }))
    .filter((v): v is { r: HistoryRow; group: string } => !!v.group);
  const skipped = rows.length - usable.length;
  if (!usable.length) return { records, added: 0, replaced: 0, skipped };

  // 같은 초의 줄은 목록에서 위쪽이 나중이므로 뒤집어서 오래된 것부터
  const ordered = usable.map((v, i) => ({ ...v, i })).sort((a, b) => a.r.time.localeCompare(b.r.time) || b.i - a.i);
  const groups = new Set(ordered.map((v) => v.group));
  const from = Date.parse(ordered[0].r.time) - 60_000;
  const to = Date.parse(ordered[ordered.length - 1].r.time) + 60_000;
  // 화면 감지 기록은 뽑기 연출이 끝나고 가챠 화면으로 돌아온 시각에 찍히므로 실제 뽑은 시각보다 늦다.
  // 그래서 화면 감지 기록은 마지막 공식 기록 뒤 15분까지 같은 뽑기로 보고 바꾼다(겹쳐 두 번 세지 않게).
  const inRange = (p: Pull) => {
    if (!groups.has(p.group)) return false;
    const t = Date.parse(p.time);
    // 직접 입력은 넣은 시각으로 찍혀 있어(실제 뽑은 시각이 아님) 구간 뒤에 있어도 같은 뽑기일 수 있다
    if (p.source === "manual" && ctx.replaceManual) return t >= from;
    return t >= from && t <= (p.source === "screen" ? to + SCREEN_LAG_MS : to);
  };
  const replacedPulls = rec.pulls.filter(inRange);
  rec.pulls = rec.pulls.filter((p) => !inRange(p));

  const added: Pull[] = [];
  let session = "";
  let lastKey = "";
  let index = 0;
  for (const { r, group } of ordered) {
    const key = `${group}|${r.time}`;
    if (key !== lastKey) { session = ctx.newId(); lastKey = key; index = 0; }
    const b = bannerFor(r, group);
    const top = r.rarity != null ? r.rarity >= ctx.topRarity : ctx.isTop(r.name);
    const unnamed = r.rarity != null && ctx.minNamedRarity != null && r.rarity < ctx.minNamedRarity;
    added.push({
      id: ctx.newId(),
      time: r.time,
      game,
      group,
      banner: b?.id ?? "",
      sessionId: session,
      indexInSession: index++,
      top,
      name: unnamed ? null : r.name,
      featured: !top ? null : ctx.featuredOf ? ctx.featuredOf(r, group) : b ? b.featured.some((f) => f.ko === r.name) : null,
      rarity: unnamed ? null : (r.rarity ?? (top ? ctx.topRarity : null)),
      source: "official",
      confidence: 1,
      status: "confirmed",
    });
  }
  rec.pulls.push(...added);
  next.undo.push({
    game,
    label: `공식 기록 ${added.length}개 반영`,
    addedPullIds: added.map((p) => p.id),
    replacedPulls,
    prevCurrency: { ...rec.currency },
  });
  return { records: next, added: added.length, replaced: replacedPulls.length, skipped };
}
