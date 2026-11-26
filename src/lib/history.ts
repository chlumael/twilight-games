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
  const m = digits(text).match(/(\d{4})\s*[.,]\s*(\d{1,2})\s*[.,]\s*(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return new Date(Date.UTC(y, mo - 1, d, h - utcOffset, mi, s)).toISOString();
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
    const name = lines.find((n) => n !== l && near(n, l) && n.x >= 0.5 && n.x < header.x - 0.02 && /[가-힣]/.test(n.t));
    if (!banner || !name) continue;
    const emergency = /긴급\s*모집/.test(banner.t);
    rows.push({
      banner: banner.t.replace(/^.*긴급\s*모집\s*[-–]\s*/, "").trim(),
      name: name.t.trim(),
      time,
      emergency,
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
  if (/집록/.test(kind)) return "genshin-chronicled";
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
