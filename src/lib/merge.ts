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

/** Set updatedAt on every game whose content changed between `prev` and `next`. */
export function stampChanged(prev: Records, next: Records, now: Date = new Date()): Records {
  let out: Records | null = null;
  for (const id of GAME_IDS) {
    if (gameFingerprint(prev.games[id]) !== gameFingerprint(next.games[id])) {
      out ??= { ...next, games: { ...next.games } };
      out.games[id] = { ...next.games[id], updatedAt: now.toISOString() };
    }
  }
  return out ?? next;
}

function newer(a: GameRecord, b: GameRecord): GameRecord {
  return (a.updatedAt ?? "") >= (b.updatedAt ?? "") ? a : b;
}

/**
 * Combine one game.
 * - "newer": the more recently changed copy wins whole (normal sync between devices).
 * - "union": first time this device links to the account and both sides have data:
 *   keep every pull from both (same id → the newer copy's version), and settings
 *   such as currency from the newer copy. Nothing recorded on either side is lost.
 */
export function mergeGame(local: GameRecord, remote: GameRecord | undefined, mode: "newer" | "union"): GameRecord {
  if (!remote || isEmpty(remote)) return local;
  if (isEmpty(local)) return remote;
  const win = newer(local, remote);
  if (mode === "newer") return win;
  const lose = win === local ? remote : local;
  const byId = new Map<string, Pull>();
  for (const p of lose.pulls) byId.set(p.id, p);
  for (const p of win.pulls) byId.set(p.id, p);
  const pulls = [...byId.values()].sort((a, b) =>
    a.time === b.time ? a.indexInSession - b.indexInSession : a.time < b.time ? -1 : 1,
  );
  return {
    ...win,
    pulls,
    baseline: { ...lose.baseline, ...win.baseline },
    currentBanner: { ...lose.currentBanner, ...win.currentBanner },
    updatedAt: new Date(Math.max(Date.parse(win.updatedAt ?? "0") || 0, Date.now())).toISOString(),
  };
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
