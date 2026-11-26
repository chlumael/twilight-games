import { describe, expect, it } from "vitest";
import { emptyRecords, recordSession } from "./ledger";
import { bannerStats, gameStats, groupStats, luckLabel, luckPercentile, topPmf } from "./stats";

const t = (min: number) => new Date(Date.UTC(2026, 10, 24, 12, min));

function sample() {
  let r = emptyRecords();
  r.games.genshin.currentBanner["genshin-char"] = "A";
  // 10뽑 중 7번째에 픽업 → 그 뒤 3뽑
  r = recordSession(r, "genshin", "genshin-char", 10, new Map([[6, { name: "가", featured: true }]]), t(0));
  // 10뽑: 꽝 (누적 13)
  r = recordSession(r, "genshin", "genshin-char", 10, new Map(), t(1));
  // 10뽑 중 10번째에 픽뚫 (23번째)
  r = recordSession(r, "genshin", "genshin-char", 10, new Map([[9, { name: "나", featured: false }]]), t(2));
  r.games.genshin.currentBanner["genshin-char"] = "B";
  r = recordSession(r, "genshin", "genshin-char", 5, new Map(), t(3));
  return r;
}

describe("통계", () => {
  it("그룹 통계: 평균·최소·최대·픽업 비율·천장 대비", () => {
    const s = groupStats(sample().games.genshin, "genshin", "genshin-char");
    expect(s.pulls).toBe(35);
    expect(s.tops).toBe(2);
    expect(s.hits.map((h) => h.count)).toEqual([7, 23]);
    expect(s.average).toBe(15);
    expect(s.best).toBe(7);
    expect(s.worst).toBe(23);
    expect(s.since).toBe(5);
    expect(s.featuredWon).toBe(1);
    expect(s.featuredLost).toBe(1);
    expect(s.featuredRate).toBe(0.5);
    expect(s.pityRatio).toBeCloseTo(15 / 90);
  });

  it("기록이 없으면 평균은 null, 이후 뽑기는 기준값을 포함", () => {
    const r = emptyRecords();
    r.games.genshin.baseline["genshin-char"] = { pity: 40, guaranteed: false, banner: "", bannerPulls: 0, bannerFeaturedGot: false };
    const s = groupStats(r.games.genshin, "genshin", "genshin-char");
    expect(s.average).toBeNull();
    expect(s.featuredRate).toBeNull();
    expect(s.pityRatio).toBeNull();
    expect(s.since).toBe(40);
  });

  it("천장이 없는 게임은 천장 대비 값이 없다", () => {
    let r = emptyRecords();
    r = recordSession(r, "limbus", "limbus-extraction", 10, new Map([[2, { name: "가", featured: true }]]), t(0));
    expect(groupStats(r.games.limbus, "limbus", "limbus-extraction").pityRatio).toBeNull();
  });

  it("배너별 기록: 최근 배너부터", () => {
    const b = bannerStats(sample().games.genshin);
    expect(b.map((x) => [x.banner, x.pulls, x.tops.length])).toEqual([["B", 5, 0], ["A", 30, 2]]);
  });

  it("게임 통계: 재화 환산", () => {
    const g = gameStats(sample().games.genshin, "genshin");
    expect(g.pulls).toBe(35);
    expect(g.tops).toBe(2);
    expect(g.spent).toEqual({ key: "primogem", label: "원석", amount: 35 * 160 });
    expect(g.firstPull).toBe(t(0).toISOString());
  });

  it("운 등급: 평균 운 기준 상위 몇 %", () => {
    const pmf = topPmf({ base: 0.006, softFrom: 74, step: 0.06 }, 90);
    expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // 원신 캐릭터: 10뽑에 나오면 아주 운이 좋음, 90뽑이면 거의 꼴찌
    expect(luckPercentile("genshin", "genshin-char", [10])!).toBeLessThan(7);
    expect(luckPercentile("genshin", "genshin-char", [90])!).toBeGreaterThan(99);
    const mid = luckPercentile("genshin", "genshin-char", [62, 62])!;
    expect(mid).toBeGreaterThan(20);
    expect(mid).toBeLessThan(50);
    expect(luckLabel(groupStats(sample().games.genshin, "genshin", "genshin-char"), "genshin")).toMatch(/^상위 /);
    // 무기 신청은 10개 묶음 단위: 첫 신청(10개)에 6성 무기 = 33.5% 안
    expect(luckPercentile("endfield", "endfield-arsenal", [10])!).toBeCloseTo(33.5167, 1);
    expect(luckPercentile("endfield", "endfield-arsenal", [40])!).toBeCloseTo(100, 5);
  });

  it("4성 기록: 화면 읽기로 이름이 남은 것만, 최근부터", () => {
    const r = sample();
    const ps = r.games.genshin.pulls;
    ps[0].name = "바바라"; ps[0].rarity = 4;
    ps[12].name = "행추"; ps[12].rarity = 4;
    expect(groupStats(r.games.genshin, "genshin", "genshin-char").rare.map((p) => p.name)).toEqual(["행추", "바바라"]);
  });
});
