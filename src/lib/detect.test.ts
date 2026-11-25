import { describe, expect, it } from "vitest";
import { countPulls, emptyDetectState, genshinReveal, step, type ItemTable } from "./detect";
import { GAMES } from "./games";
import { readScreen, type ScreenLine } from "./recognize";
import type { GameId } from "./types";

const L = (t: string, x: number, y: number, h = 0.03, w = 0.1): ScreenLine => ({ t, x, y, w, h });
const table: ItemTable = {
  바바라: { rarity: 4, kind: "character" },
  탄궁: { rarity: 3, kind: "weapon" },
  "차가운 칼날": { rarity: 3, kind: "weapon" },
  자백: { rarity: 5, kind: "character" },
};
let n = 0;
const ctx = {
  spendOf: (g: GameId) => GAMES[g].groups[0].spend,
  genshinItems: table,
  newId: () => `d${++n}`,
};
const main = (primo: number, fate: number, time = 0) => {
  const f = { time, landscape: true, lines: [
    L("4", 0.61, 0.04), L(`850 수${primo} +`, 0.68, 0.04, 0.03, 0.13), L(String(fate), 0.86, 0.04),
    L("기원 1회", 0.62, 0.89), L("기원 10회", 0.81, 0.89),
  ] };
  return { frame: f, reading: readScreen(f) };
};
const reveal = (name: string, time = 0) => ({ frame: { time, landscape: true, lines: [L(name, 0.05, 0.5)] }, reading: null });

function run(frames: { frame: Parameters<typeof step>[1]; reading: Parameters<typeof step>[2] }[]) {
  let s = emptyDetectState();
  const out = [];
  for (const f of frames) {
    const r = step(s, f.frame, f.reading, ctx);
    s = r.state;
    if (r.detection) out.push(r.detection);
  }
  return out;
}

describe("뽑기 감지", () => {
  it("재화 차이로 횟수: 인연 먼저, 원석 160", () => {
    const spend = GAMES.genshin.groups[0].spend;
    expect(countPulls({ primogem: 1600, intertwined: 5 }, { primogem: 800, intertwined: 0 }, spend))
      .toEqual({ count: 10, uncertain: false, spent: { intertwined: 5, primogem: 800 } });
    expect(countPulls({ primogem: 100, intertwined: 0 }, { primogem: 900, intertwined: 0 }, spend).uncertain).toBe(true);
  });

  it("공개 화면 이름: 아이콘이 붙어 읽혀도, 오른쪽 글자는 무시", () => {
    expect(genshinReveal([L("아바바라", 0.05, 0.5)], table)?.name).toBe("바바라");
    expect(genshinReveal([L("차가운 칼날", 0.2, 0.55)], table)?.info.rarity).toBe(3);
    expect(genshinReveal([L("자백", 0.55, 0.63)], table)).toBeNull();
  });

  it("메인 → 공개 화면들 → 메인: 10회와 본 이름들", () => {
    const d = run([
      main(1600, 10), main(1600, 10), // 두 번 같게 읽혀 기준이 됨
      reveal("바바라"), reveal("바바라"), // 같은 화면이 두 번 읽혀도 한 번
      reveal("탄궁"), reveal("자백"),
      main(1600, 0), main(1600, 0),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ game: "genshin", count: 10, uncertain: true, spent: { intertwined: 10 } });
    expect(d[0].items.map((i) => [i.name, i.rarity])).toEqual([["바바라", 4], ["탄궁", 3], ["자백", 5]]);
  });

  it("한 번만 잘못 읽힌 숫자로는 감지하지 않는다", () => {
    expect(run([main(1600, 10), main(1600, 10), main(160, 10), main(1600, 10), main(1600, 10)])).toEqual([]);
  });

  it("재화가 늘기만 하면 감지하지 않는다", () => {
    expect(run([main(100, 0), main(100, 0), main(1700, 0), main(1700, 0)])).toEqual([]);
  });

  it("공개 화면 수와 횟수가 같으면 확실", () => {
    const d = run([main(160, 0), main(160, 0), reveal("탄궁"), main(0, 0), main(0, 0)]);
    expect(d[0]).toMatchObject({ count: 1, uncertain: false });
  });
});
