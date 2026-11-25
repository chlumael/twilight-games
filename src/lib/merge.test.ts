import { describe, expect, it } from "vitest";
import { emptyRecords, recordSession } from "./ledger";
import { gameFingerprint, gamesToPush, mergeGame, mergeRecords, stampChanged } from "./merge";

const t = (min: number) => new Date(Date.UTC(2026, 10, 25, 12, min));

describe("sync merge", () => {
  it("stamps only the games that changed", () => {
    const a = emptyRecords();
    const b = recordSession(a, "genshin", "genshin-char", 10, new Map(), t(0));
    const s = stampChanged(a, b, t(1));
    expect(s.games.genshin.updatedAt).toBe(t(1).toISOString());
    expect(s.games.limbus.updatedAt).toBeUndefined();
  });

  it("newer copy wins in normal sync", () => {
    const phone = { ...recordSession(emptyRecords(), "genshin", "genshin-char", 10, new Map(), t(0)).games.genshin, updatedAt: t(5).toISOString() };
    const server = { ...recordSession(emptyRecords(), "genshin", "genshin-char", 1, new Map(), t(0)).games.genshin, updatedAt: t(2).toISOString() };
    expect(mergeGame(phone, server, "newer").pulls).toHaveLength(10);
    expect(mergeGame({ ...phone, updatedAt: t(1).toISOString() }, server, "newer").pulls).toHaveLength(1);
  });

  it("first link keeps pulls from both sides", () => {
    const local = { ...recordSession(emptyRecords(), "limbus", "limbus-extraction", 10, new Map(), t(0)).games.limbus, updatedAt: t(3).toISOString() };
    const remote = { ...recordSession(emptyRecords(), "limbus", "limbus-extraction", 10, new Map(), t(1)).games.limbus, updatedAt: t(2).toISOString() };
    const m = mergeGame(local, remote, "union");
    expect(m.pulls).toHaveLength(20);
    expect(new Set(m.pulls.map((p) => p.id)).size).toBe(20);
  });

  it("an empty side never wipes the other", () => {
    const local = recordSession(emptyRecords(), "arknights", "arknights-limited", 10, new Map(), t(0));
    const merged = mergeRecords(local, { arknights: emptyRecords().games.arknights }, "newer");
    expect(merged.games.arknights.pulls).toHaveLength(10);
    const fresh = mergeRecords(emptyRecords(), { arknights: local.games.arknights }, "newer");
    expect(fresh.games.arknights.pulls).toHaveLength(10);
  });

  it("pushes only games that differ from the server copy", () => {
    const r = recordSession(emptyRecords(), "genshin", "genshin-char", 1, new Map(), t(0));
    expect(gamesToPush(r, {})).toEqual(["genshin"]);
    expect(gamesToPush(r, { genshin: gameFingerprint(r.games.genshin) })).toEqual([]);
  });
});
