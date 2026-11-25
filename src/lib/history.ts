// 공식 기록 화면 읽기: 게임 안(또는 공식 웹) 뽑기 기록 화면의 글자를 줄 단위 기록으로 바꾸고,
// 앱 기록에 반영한다. 공식 기록은 화면 인식·수동 입력보다 우선한다(CLAUDE.md 원칙).
// 지금은 엔드필드 "헤드헌팅 기록" (사용자 실기 자료 2026-11-25).
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

export interface ImportResult {
  records: Records;
  added: number;
  replaced: number;
  skipped: number;
}

/**
 * 공식 기록을 앱 기록에 반영한다.
 * - 배너 이름으로 배너 자료에서 종류(한정/재구축)를 찾는다. 못 찾으면(기초 헤드헌팅 등) 건너뛴다.
 * - 긴급 모집은 천장·누적 횟수에 안 들어가므로 넣지 않는다.
 * - 기록이 덮는 시간 구간 안의 기존 뽑기(화면 감지·수동)는 공식 기록으로 바꾼다.
 */
export function importHistory(
  records: Records,
  game: GameId,
  rows: HistoryRow[],
  ctx: { banners: PackBanner[]; isTop: (name: string) => boolean; newId: () => string },
): ImportResult {
  const next = structuredClone(records);
  const rec = next.games[game];
  const findBanner = (name: string) => ctx.banners.find((b) => b.name.includes(`「${name}」`) || b.name === name);
  const usable = rows
    .filter((r) => !r.emergency)
    .map((r) => ({ r, b: findBanner(r.banner) }))
    .filter((v): v is { r: HistoryRow; b: PackBanner } => !!v.b);
  const skipped = rows.length - usable.length;
  if (!usable.length) return { records, added: 0, replaced: 0, skipped };

  // 같은 초의 줄은 목록에서 위쪽이 나중이므로 뒤집어서 오래된 것부터
  const ordered = usable.map((v, i) => ({ ...v, i })).sort((a, b) => a.r.time.localeCompare(b.r.time) || b.i - a.i);
  const groups = new Set(ordered.map((v) => v.b.group));
  const from = Date.parse(ordered[0].r.time) - 60_000;
  const to = Date.parse(ordered[ordered.length - 1].r.time) + 60_000;
  const inRange = (p: Pull) => groups.has(p.group) && Date.parse(p.time) >= from && Date.parse(p.time) <= to;
  const replacedPulls = rec.pulls.filter(inRange);
  rec.pulls = rec.pulls.filter((p) => !inRange(p));

  const added: Pull[] = [];
  let session = "";
  let lastTime = "";
  let index = 0;
  for (const { r, b } of ordered) {
    if (r.time !== lastTime) { session = ctx.newId(); lastTime = r.time; index = 0; }
    const top = ctx.isTop(r.name);
    added.push({
      id: ctx.newId(),
      time: r.time,
      game,
      group: b.group,
      banner: b.id,
      sessionId: session,
      indexInSession: index++,
      top,
      name: r.name,
      featured: top ? b.featured.some((f) => f.ko === r.name) : null,
      rarity: top ? 6 : null,
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
