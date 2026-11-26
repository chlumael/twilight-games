// 달력 (사용자 요청 2026-11-26): 픽업 기간, 게임 안 이벤트, 버전 시작·끝, 외부 행사, 내가 넣은 일정을 한 곳에서 본다.
// 픽업은 배너 자료에서, 이벤트·버전·외부 소식은 배너 자료 파일의 events(scripts/banners/events.mjs)에서, 내 일정은 설정에서 온다.
import { bannerLabel, type BannerPack, type PackEvent } from "./banners";
export type { PackEvent };
import { GAMES } from "./games";
import type { GameId } from "./types";

export type CalKind = "pickup" | "event" | "version" | "offline" | "mine";

export const KIND_LABEL: Record<CalKind, string> = {
  pickup: "픽업",
  event: "이벤트",
  version: "버전",
  offline: "외부 행사",
  mine: "내 일정",
};

/** 사용자가 직접 넣은 일정 (설정에 저장·동기화) */
export interface MyEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD, 없으면 하루 */
  end: string | null;
  game: GameId | null;
}

export interface CalItem {
  id: string;
  kind: CalKind;
  game: GameId | null;
  title: string;
  /** 시각(ms) */
  start: number;
  /** 시각(ms). null = 끝나는 날 미정 */
  end: number | null;
  approx: boolean;
  source?: string;
  url?: string;
}

const DAY = 864e5;

/** YYYY-MM-DD → 그날 0시(현지) */
export function ymdStart(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}
export function dayOf(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
export function ymd(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 모든 일정을 한 목록으로 */
export function buildItems(pack: BannerPack | null, mine: MyEvent[] = []): CalItem[] {
  const out: CalItem[] = [];
  for (const [game, list] of Object.entries(pack?.games ?? {}) as [GameId, NonNullable<BannerPack["games"][GameId]>][]) {
    for (const b of list) {
      if (!b.start) continue;
      const group = GAMES[game]?.groups.find((g) => g.id === b.group);
      out.push({
        id: `pickup:${b.id}`, kind: "pickup", game,
        title: `${group ? `${group.name} · ` : ""}${bannerLabel(b)}`,
        start: Date.parse(b.start), end: b.end ? Date.parse(b.end) : null,
        approx: !!(b.startApprox || b.endApprox), source: b.source,
      });
    }
  }
  const events = pack?.events ?? {};
  for (const [game, list] of Object.entries(events) as [GameId, PackEvent[]][]) {
    for (const e of list ?? []) {
      const start = Date.parse(e.start);
      if (Number.isNaN(start)) continue;
      out.push({
        id: e.id, kind: e.kind, game, title: e.title, start, end: e.end ? Date.parse(e.end) : null,
        approx: !!(e.startApprox || e.endApprox), source: e.source, url: e.url,
      });
    }
  }
  for (const m of mine) {
    out.push({
      id: `mine:${m.id}`, kind: "mine", game: m.game, title: m.title,
      start: ymdStart(m.start), end: ymdStart(m.end ?? m.start) + DAY - 1, approx: false,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * 그날(0시~24시)에 걸치는 일정. 끝나는 날이 없는 일정은 시작한 날만 보인다(외부 소식처럼 하루짜리)거나,
 * 버전·이벤트처럼 "진행 중"이면 오늘까지 이어진 것으로 본다.
 */
export function onDay(items: CalItem[], day: number, now: number = Date.now()): CalItem[] {
  const from = dayOf(day);
  const to = from + DAY;
  return items.filter((it) => {
    const end = it.end ?? (it.kind === "offline" || it.kind === "mine" ? dayOf(it.start) + DAY - 1 : Math.max(now, it.start));
    return it.start < to && end >= from;
  });
}

/** 그날 시작·끝나는지 */
export function edgeOn(it: CalItem, day: number): "start" | "end" | "both" | null {
  const from = dayOf(day);
  const s = dayOf(it.start) === from;
  const e = it.end !== null && dayOf(it.end) === from;
  return s && e ? "both" : s ? "start" : e ? "end" : null;
}

/** 달력 칸: 그 달 1일이 있는 주의 일요일부터 6주(42칸) */
export function monthCells(year: number, month: number): { day: number; inMonth: boolean }[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const cells: { day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ day: d.getTime(), inMonth: d.getMonth() === month });
  }
  return cells;
}

/** "11/24 ~ 12/23", 끝 미정이면 "11/24 ~ 미정", 하루짜리면 "11/24" */
export function periodText(it: CalItem): string {
  const md = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
  if (it.end === null) return it.kind === "offline" ? md(it.start) : `${md(it.start)} ~ 미정`;
  if (dayOf(it.start) === dayOf(it.end)) return md(it.start);
  return `${md(it.start)} ~ ${md(it.end)}`;
}

/** 오늘 기준 남은 날: 끝나는 날까지 "D-3", 시작 전이면 "3일 뒤 시작" */
export function dText(it: CalItem, now: number = Date.now()): string {
  const today = dayOf(now);
  if (it.start > now) {
    const n = Math.round((dayOf(it.start) - today) / DAY);
    return n === 0 ? "오늘 시작" : `${n}일 뒤 시작`;
  }
  if (it.end === null) return "";
  if (it.end < now) return "종료";
  const n = Math.round((dayOf(it.end) - today) / DAY);
  return n === 0 ? "오늘 종료" : `D-${n}`;
}

/** 내 일정 글 확인: 제목·날짜가 있고 끝이 시작보다 앞이 아니어야 한다 */
export function validMine(m: Partial<MyEvent>): m is MyEvent {
  if (!m.title?.trim() || !m.start || !/^\d{4}-\d{2}-\d{2}$/.test(m.start)) return false;
  if (m.end && (!/^\d{4}-\d{2}-\d{2}$/.test(m.end) || m.end < m.start)) return false;
  return true;
}

/**
 * 두 기기의 내 일정 합치기: 양쪽에 있는 것을 모두 남기되, 어느 쪽에서든 지운 것(removed)은 뺀다.
 * 같은 id면 이쪽(local) 것을 쓴다.
 */
export function mergeMine(local: MyEvent[], remote: MyEvent[], removed: string[]): MyEvent[] {
  const gone = new Set(removed);
  const byId = new Map<string, MyEvent>();
  for (const m of [...remote, ...local]) if (!gone.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.start.localeCompare(b.start));
}
