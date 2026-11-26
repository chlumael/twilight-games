// How records from two places (this device, the account on the server) are combined.
// Pure functions: no Firebase here, so they can be tested.
import { GAME_IDS } from "./games";
import type { GameId, GameRecord, Pull, Records } from "./types";

/** A game's content without its timestamp, for change detection. */
export function gameFingerprint(g: GameRecord): string {
  const { updatedAt: _ignored, ...rest } = g;
  return JSON.stringify(rest);
}

function isEmpty(g: GameRecord | undefined): boolean {
  if (!g) return true;
  return (
    g.pulls.length === 0 &&
    Object.keys(g.currency).length === 0 &&
    Object.keys(g.baseline).length === 0 &&
    Object.keys(g.currentBanner).length === 0
  );
}

/** 지움 표시를 이 개수까지만 보관한다 (오래된 것부터 버림) */
const REMOVED_LIMIT = 1000;

function trimRemoved(removed: Record<string, string>): Record<string, string> {
  const entries = Object.entries(removed);
  if (entries.length <= REMOVED_LIMIT) return removed;
  return Object.fromEntries(entries.sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, REMOVED_LIMIT));
}

/**
 * Set updatedAt on every game whose content changed between `prev` and `next`.
 * 이때 사라진 뽑기에는 "지움 표시"를 남긴다(다른 기기와 합칠 때 되살아나지 않게). 다시 생긴 뽑기는 표시를 지운다.
 */
export function stampChanged(prev: Records, next: Records, now: Date = new Date()): Records {
  let out: Records | null = null;
  for (const id of GAME_IDS) {
    if (gameFingerprint(prev.games[id]) !== gameFingerprint(next.games[id])) {
      out ??= { ...next, games: { ...next.games } };
      const g = next.games[id];
      const have = new Set(g.pulls.map((p) => p.id));
      // 값이 "!"로 시작하면 "다시 살림" 표시(되돌리기로 복구) — 다른 기기의 예전 지움 표시보다 나중이면 살아 있다
      const removed: Record<string, string> = {};
      for (const [k, v] of Object.entries(g.removed ?? {})) {
        if (have.has(k) && !v.startsWith("!")) removed[k] = `!${now.toISOString()}`; // 지웠던 것이 다시 생김
        else removed[k] = v;
      }
      for (const p of prev.games[id].pulls) if (!have.has(p.id)) removed[p.id] = now.toISOString();
      out.games[id] = { ...g, removed: trimRemoved(removed), updatedAt: now.toISOString() };
      if (!Object.keys(removed).length) delete out.games[id].removed;
    }
  }
  return out ?? next;
}

function newer(a: GameRecord, b: GameRecord): GameRecord {
  return (a.updatedAt ?? "") >= (b.updatedAt ?? "") ? a : b;
}

const byTime = (a: Pull, b: Pull) => (a.time === b.time ? a.indexInSession - b.indexInSession : a.time < b.time ? -1 : 1);
/** 공식 기록은 어느 기기에서 읽어도 같은 뽑기다 → 내용으로 같은지 본다 */
const officialKey = (p: Pull) => `${p.group}|${p.time}|${p.name}|${p.indexInSession}`;
/** 화면 감지 기록이 실제 뽑은 시각보다 늦게 찍히는 여유 (history.ts의 SCREEN_LAG_MS와 같은 값) */
const LAG = 15 * 60 * 1000;

/**
 * 한 게임을 뽑기 단위로 합친다 (DESIGN.md §8-2, R1).
 * - 뽑기: 두 쪽을 id로 합친다(같은 id는 더 최근에 바뀐 쪽 것). 한쪽에서 지운 뽑기(지움 표시)는 되살리지 않는다.
 *   단, 더 최근 쪽에 그 뽑기가 다시 있으면(되돌리기로 복구) 살린다.
 * - 공식 기록은 내용이 같으면 한 번만. 한쪽의 공식 기록 구간 안에 있는 다른 쪽의 화면 감지 기록은 버린다(공식 > 화면).
 * - 재화·시작 상태·배너·예측 설정은 더 최근에 바뀐 쪽 것.
 * mode는 예전 호환용으로 남겨 둔다(둘 다 같은 방식으로 합친다).
 */
export function mergeGame(local: GameRecord, remote: GameRecord | undefined, _mode: "newer" | "union" = "union"): GameRecord {
  if (!remote || isEmpty(remote)) return local;
  if (isEmpty(local)) return remote;
  const win = newer(local, remote);
  const lose = win === local ? remote : local;
  const winIds = new Set(win.pulls.map((p) => p.id));
  // 지움 표시는 id마다 더 나중 것을 따른다 ("!시각" = 다시 살림)
  const when = (v: string) => v.replace(/^!/, "");
  const marks: Record<string, string> = { ...(lose.removed ?? {}) };
  for (const [k, v] of Object.entries(win.removed ?? {})) if (!marks[k] || when(v) >= when(marks[k])) marks[k] = v;
  const removed: Record<string, string> = {}; // 실제로 지워진 것만
  for (const [k, v] of Object.entries(marks)) if (!v.startsWith("!")) removed[k] = v;

  const winOfficial = new Set(win.pulls.filter((p) => p.source === "official").map(officialKey));
  const span = (g: GameRecord) => {
    const m = new Map<string, [number, number]>();
    for (const p of g.pulls) {
      if (p.source !== "official") continue;
      const t = Date.parse(p.time);
      const cur = m.get(p.group);
      m.set(p.group, cur ? [Math.min(cur[0], t), Math.max(cur[1], t)] : [t, t]);
    }
    return m;
  };
  const covered = (p: Pull, spans: Map<string, [number, number]>) => {
    const sp = spans.get(p.group);
    const t = Date.parse(p.time);
    return p.source === "screen" && !!sp && t >= sp[0] - 60_000 && t <= sp[1] + LAG;
  };
  const winSpan = span(win);
  const loseSpan = span(lose);
  const loseIds = new Set(lose.pulls.map((p) => p.id));
  const pulls: Pull[] = [];
  for (const p of win.pulls) {
    if (removed[p.id]) continue; // 상대가 지움
    if (!loseIds.has(p.id) && covered(p, loseSpan)) continue; // 상대의 공식 기록이 이 구간을 덮음
    pulls.push(p);
  }
  for (const p of lose.pulls) {
    if (winIds.has(p.id) || removed[p.id]) continue;
    if (p.source === "official" && winOfficial.has(officialKey(p))) continue;
    if (covered(p, winSpan)) continue;
    pulls.push(p);
  }
  pulls.sort(byTime);
  const out: GameRecord = {
    ...win,
    pulls,
    baseline: { ...lose.baseline, ...win.baseline },
    currentBanner: { ...lose.currentBanner, ...win.currentBanner },
    removed: trimRemoved(marks),
  };
  if (!Object.keys(marks).length) delete out.removed;
  // 이긴 쪽과 내용이 달라졌으면(상대 기록이 더해짐) 지금 시각으로 찍어 다시 올리게 한다
  if (gameFingerprint(out) !== gameFingerprint(win)) {
    out.updatedAt = new Date(Math.max(Date.parse(win.updatedAt ?? "0") || 0, Date.now())).toISOString();
  }
  return out;
}

export function mergeRecords(
  local: Records,
  remote: Partial<Record<GameId, GameRecord>>,
  mode: "newer" | "union",
): Records {
  const games = { ...local.games };
  for (const id of GAME_IDS) games[id] = mergeGame(local.games[id], remote[id], mode);
  return { ...local, games };
}

/** Games whose local copy differs from what the server last had. */
export function gamesToPush(local: Records, lastPushed: Partial<Record<GameId, string>>): GameId[] {
  return GAME_IDS.filter((id) => !isEmpty(local.games[id]) || lastPushed[id] !== undefined)
    .filter((id) => lastPushed[id] !== gameFingerprint(local.games[id]));
}
