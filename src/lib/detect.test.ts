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
const main = (primo: number, fate: number, time = 1000) => {
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

  it("가챠 화면을 열자마자 뽑아도, 예전에 읽어 둔 재화로 센다 (오래된 값이면 확실하지 않음)", () => {
    let s = emptyDetectState();
    for (const f of [main(1600, 10, 0), main(1600, 10, 1000)]) s = step(s, f.frame, f.reading, ctx).state;
    // 앱을 껐다 켰다고 치고 저장해 둔 값만 남긴다
    s = { ...emptyDetectState(), stable: s.stable, stableAt: s.stableAt };
    const later = 60 * 60 * 1000;
    const out = [];
    for (const f of [main(1600, 0, later), main(1600, 0, later + 1000)]) {
      const r = step(s, f.frame, f.reading, ctx);
      s = r.state;
      if (r.detection) out.push(r.detection);
    }
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ count: 10, uncertain: true });
  });

  it("10배 넘게 뛴 값은 다섯 번 연속 읽혀야 믿고, 100회가 넘는 감지는 기록하지 않는다", () => {
    const ef = (oro: number, time: number) => {
      const f = { time, landscape: true, lines: [
        L("10500", 0.775, 0.03, 0.02, 0.035), L(String(oro), 0.873, 0.03, 0.02, 0.036),
        L("1회 헤드헌팅", 0.74, 0.91), L("10회 헤드헌팅", 0.89, 0.91),
      ] };
      return { frame: f, reading: readScreen(f) };
    };
    const play = (frames: ReturnType<typeof ef>[]) => {
      let st = emptyDetectState();
      const found = [];
      for (const f of frames) {
        const r = step(st, f.frame, f.reading, { ...ctx, spendOf: () => GAMES.endfield.groups[0].spend });
        st = r.state;
        if (r.detection) found.push(r.detection);
      }
      return { found, stable: st.stable.endfield };
    };
    // 55025 → 550251(잘못 읽음) 두 번: 믿지 않는다 → 다시 55025 → 감지 없음
    let out = play([ef(55025, 1), ef(55025, 2), ef(550251, 3), ef(550251, 4), ef(55025, 5), ef(55025, 6)]);
    expect(out.found).toEqual([]);
    expect(out.stable).toMatchObject({ oroberyl: 55025 });
    // 이미 잘못된 값(550251)이 들어가 있다가 바로잡히는 경우: 990회 같은 감지를 만들지 않는다
    out = play([ef(550251, 1), ef(550251, 2), ef(55025, 3), ef(55025, 4)]);
    expect(out.found).toEqual([]);
    expect(out.stable).toMatchObject({ oroberyl: 55025 });
  });

  it("숫자 하나가 가끔 빠져 읽혀도 재화가 반영되고 뽑기를 센다 (PC)", () => {
    const ef = (permits: [number, number] | null, oro: number, time: number) => {
      const f = { time, landscape: true, lines: [
        ...(permits ? [L(String(permits[0]), 0.6, 0.03, 0.02, 0.01), L(String(permits[1]), 0.68, 0.03, 0.02, 0.01)] : []),
        L("10500", 0.775, 0.03, 0.02, 0.035), L(String(oro), 0.873, 0.03, 0.02, 0.036),
        L("1회 헤드헌팅", 0.74, 0.91), L("10회 헤드헌팅", 0.89, 0.91),
      ] };
      return { frame: f, reading: readScreen(f) };
    };
    let st = emptyDetectState();
    const found = [];
    // 허가증이 읽혔다 안 읽혔다 한다 → 그래도 믿을 값이 쌓이고, 10회(허가증 5 + 오로베릴 2500)를 센다
    for (const f of [ef([5, 0], 55025, 1), ef(null, 55025, 2), ef([5, 0], 55025, 3), ef(null, 52525, 4), ef([0, 0], 52525, 5), ef([0, 0], 52525, 6)]) {
      const r = step(st, f.frame, f.reading, { ...ctx, spendOf: () => GAMES.endfield.groups[0].spend });
      st = r.state;
      if (r.detection) found.push(r.detection);
    }
    expect(st.stable.endfield).toMatchObject({ oroberyl: 52525, charteredPermit: 0, limitedPermit: 0 });
    expect(found.reduce((a, d) => a + d.count, 0)).toBe(10);
  });
});
