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

  it("두 기기에서 각각 기록해도 둘 다 남는다 (뽑기 단위 합치기), 재화는 더 최근 쪽", () => {
    const phone = { ...recordSession(emptyRecords(), "genshin", "genshin-char", 10, new Map(), t(0)).games.genshin, currency: { primogem: 100 }, updatedAt: t(5).toISOString() };
    const pc = { ...recordSession(emptyRecords(), "genshin", "genshin-char", 1, new Map(), t(1)).games.genshin, currency: { primogem: 999 }, updatedAt: t(2).toISOString() };
    const m = mergeGame(phone, pc);
    expect(m.pulls).toHaveLength(11);
    expect(m.currency).toEqual({ primogem: 100 });
    expect(mergeGame(m, pc).pulls).toHaveLength(11); // 다시 합쳐도 그대로
  });

  it("한쪽에서 지운 뽑기는 되살아나지 않고, 되돌리기로 복구한 뽑기는 산다", () => {
    const base = recordSession(emptyRecords(), "genshin", "genshin-char", 3, new Map(), t(0));
    const server = { ...base.games.genshin, updatedAt: t(1).toISOString() };
    // 휴대폰에서 한 개 지움 → 지움 표시
    const cut = structuredClone(base);
    const gone = cut.games.genshin.pulls.pop()!;
    const phone = stampChanged(base, cut, t(2)).games.genshin;
    expect(phone.removed?.[gone.id]).toBeTruthy();
    const m = mergeGame(phone, server);
    expect(m.pulls.map((p) => p.id)).not.toContain(gone.id);
    // 서버 쪽이 더 최근이어도(다른 변경) 지운 것은 지운 채로
    expect(mergeGame(phone, { ...server, updatedAt: t(9).toISOString() }).pulls).toHaveLength(2);
    // 휴대폰에서 다시 살림(되돌리기) → 표시가 지워지고 합쳐도 남는다
    const back = stampChanged({ ...cut, games: { ...cut.games, genshin: phone } }, { ...base, games: { ...base.games, genshin: { ...phone, pulls: base.games.genshin.pulls } } }, t(3)).games.genshin;
    expect(back.removed?.[gone.id]?.startsWith("!")).toBe(true); // "다시 살림" 표시
    expect(mergeGame(back, m).pulls).toHaveLength(3);
  });

  it("같은 공식 기록을 두 기기에서 읽어도 한 번만, 공식 구간 안의 다른 기기 화면 감지 기록은 버린다", () => {
    const mk = (id: string, min: number, source: "official" | "screen" | "manual", name: string | null = null) => ({
      id, time: t(min).toISOString(), game: "endfield" as const, group: "endfield-chartered", banner: "", sessionId: id, indexInSession: 0,
      top: false, name, featured: null, source, confidence: 1, status: "confirmed" as const,
    });
    const empty = emptyRecords().games.endfield;
    const phone = { ...empty, pulls: [mk("a1", 0, "official", "가"), mk("a2", 10, "official", "나")], updatedAt: t(20).toISOString() };
    const pc = { ...empty, pulls: [mk("b1", 0, "official", "가"), mk("b2", 12, "screen"), mk("b3", 12, "manual"), mk("b4", 40, "screen")], updatedAt: t(30).toISOString() };
    const ids = mergeGame(phone, pc).pulls.map((p) => p.id).sort();
    expect(ids).toEqual(["a2", "b1", "b3", "b4"]);
  });

  it("first link keeps pulls from both sides", () => {
    const local = { ...recordSession(emptyRecords(), "limbus", "limbus-extraction", 10, new Map(), t(0)).games.limbus, updatedAt: t(3).toISOString() };
    const remote = { ...recordSession(emptyRecords(), "limbus", "limbus-extraction", 10, new Map(), t(1)).games.limbus, updatedAt: t(2).toISOString() };
    const m = mergeGame(local, remote);
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
