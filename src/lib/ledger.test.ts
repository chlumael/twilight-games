import { describe, expect, it } from "vitest";
import { GAMES } from "./games";
import {
  availablePulls,
  deduct,
  emptyBaseline,
  emptyRecords,
  groupStatus,
  markTopInLastSession,
  normalizeRecords,
  recordSession,
  setCurrency,
  spendPreview,
  topHistory,
  undo,
} from "./ledger";

const t = (min: number) => new Date(Date.UTC(2026, 10, 24, 12, min));

describe("pity", () => {
  it("counts pulls since the last top and resets on top", () => {
    let r = emptyRecords();
    r = recordSession(r, "genshin", "genshin-char", 10, new Map(), t(0));
    expect(groupStatus(r.games.genshin, "genshin", "genshin-char").pity).toBe(10);
    r = recordSession(r, "genshin", "genshin-char", 10, new Map([[6, { name: "A", featured: true }]]), t(1));
    // positions 7,8,9 after the top
    expect(groupStatus(r.games.genshin, "genshin", "genshin-char").pity).toBe(3);
  });

  it("adds the baseline pity when no top was recorded", () => {
    let r = emptyRecords();
    r.games.genshin.baseline["genshin-char"] = { ...emptyBaseline(), pity: 40, guaranteed: true };
    r = recordSession(r, "genshin", "genshin-char", 1, new Map(), t(0));
    const s = groupStatus(r.games.genshin, "genshin", "genshin-char");
    expect(s.pity).toBe(41);
    expect(s.guaranteed).toBe(true);
  });

  it("guarantee follows the last 50:50 result", () => {
    let r = emptyRecords();
    r = recordSession(r, "genshin", "genshin-char", 1, new Map([[0, { name: "치치", featured: false }]]), t(0));
    expect(groupStatus(r.games.genshin, "genshin", "genshin-char").guaranteed).toBe(true);
    r = recordSession(r, "genshin", "genshin-char", 1, new Map([[0, { name: "픽업", featured: true }]]), t(1));
    expect(groupStatus(r.games.genshin, "genshin", "genshin-char").guaranteed).toBe(false);
  });

  it("does not carry pity across banners when the group does not carry over", () => {
    let r = emptyRecords();
    r.games.arknights.currentBanner["arknights-limited"] = "A";
    r = recordSession(r, "arknights", "arknights-limited", 10, new Map(), t(0));
    r.games.arknights.currentBanner["arknights-limited"] = "B";
    const s = groupStatus(r.games.arknights, "arknights", "arknights-limited");
    expect(s.pity).toBe(0);
    expect(s.counters[0]).toMatchObject({ label: "선택 영입", remaining: 300 });
  });

  it("Endfield 120 guarantee ends once featured is obtained; 80 pity carries over", () => {
    let r = emptyRecords();
    const g = "endfield-chartered";
    r.games.endfield.currentBanner[g] = "B1";
    r = recordSession(r, "endfield", g, 10, new Map([[9, { name: "x", featured: false }]]), t(0));
    let s = groupStatus(r.games.endfield, "endfield", g);
    expect(s.counters.find((c) => c.at === 120)).toMatchObject({ remaining: 110, done: false });
    r = recordSession(r, "endfield", g, 10, new Map([[0, { name: "pick", featured: true }]]), t(1));
    s = groupStatus(r.games.endfield, "endfield", g);
    expect(s.counters.find((c) => c.at === 120)?.done).toBe(true);
    expect(s.counters.find((c) => c.at === 240)?.remaining).toBe(220);
    r.games.endfield.currentBanner[g] = "B2";
    s = groupStatus(r.games.endfield, "endfield", g);
    expect(s.pity).toBe(9);
    expect(s.bannerPulls).toBe(0);
  });
});

describe("currency", () => {
  it("Arknights uses 10-pull permit, then permits, then orundum", () => {
    const spend = GAMES.arknights.groups[0].spend;
    const cur = { tenPermit: 1, permit: 3, orundum: 6000 };
    expect(availablePulls(cur, spend)).toBe(23);
    const a = deduct(cur, spend, 10);
    expect(a.currency).toEqual({ tenPermit: 0, permit: 3, orundum: 6000 });
    const b = deduct(a.currency, spend, 10);
    expect(b.currency).toEqual({ tenPermit: 0, permit: 0, orundum: 1800 });
    expect(b.shortfall).toBe(0);
  });

  it("previews what a pull would spend", () => {
    const spend = GAMES.arknights.groups[0].spend;
    expect(spendPreview({ tenPermit: 0, permit: 3, orundum: 6000 }, spend, 10)).toEqual({
      items: [{ key: "permit", amount: 3 }, { key: "orundum", amount: 4200 }],
      shortfall: 0,
    });
  });

  it("reports shortfall when currency runs out", () => {
    const spend = GAMES.limbus.groups[0].spend;
    const r = deduct({ lunacy: 300 }, spend, 10);
    expect(r.currency.lunacy).toBe(40);
    expect(r.shortfall).toBe(8);
  });

  it("recording a session deducts currency and undo restores it", () => {
    let r = setCurrency(emptyRecords(), "genshin", { intertwined: 5, primogem: 1600 });
    r = recordSession(r, "genshin", "genshin-char", 10, new Map(), t(0));
    expect(r.games.genshin.currency).toMatchObject({ intertwined: 0, primogem: 800 });
    const u = undo(r);
    expect(u.records.games.genshin.currency).toMatchObject({ intertwined: 5, primogem: 1600 });
    expect(u.records.games.genshin.pulls).toHaveLength(0);
  });
});

describe("history", () => {
  it("counts pulls taken per top, including the baseline", () => {
    let r = emptyRecords();
    r.games.genshin.baseline["genshin-char"] = { ...emptyBaseline(), pity: 70 };
    r = recordSession(r, "genshin", "genshin-char", 10, new Map([[3, { name: "A", featured: false }]]), t(0));
    r = recordSession(r, "genshin", "genshin-char", 10, new Map([[9, { name: "B", featured: true }]]), t(1));
    expect(topHistory(r.games.genshin, "genshin-char").map((h) => h.count)).toEqual([74, 16]);
  });
});

describe("editing", () => {
  it("marks a position of the last session as top and can undo it", () => {
    let r = recordSession(emptyRecords(), "limbus", "limbus-extraction", 10, new Map(), t(0));
    r = markTopInLastSession(r, "limbus", "limbus-extraction", 4, { name: "인격", featured: true });
    expect(groupStatus(r.games.limbus, "limbus", "limbus-extraction").pity).toBe(5);
    r = undo(r).records;
    expect(groupStatus(r.games.limbus, "limbus", "limbus-extraction").pity).toBe(10);
  });

  it("normalizes partial files", () => {
    const r = normalizeRecords({ games: { genshin: { pulls: [] } } });
    expect(r.games.limbus.pulls).toEqual([]);
    expect(r.games.genshin.currency).toEqual({});
  });
});
