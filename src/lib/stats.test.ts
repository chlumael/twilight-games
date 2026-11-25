import { describe, expect, it } from "vitest";
import { emptyRecords, recordSession } from "./ledger";
import { bannerStats, gameStats, groupStats, luckLabel } from "./stats";

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

  it("운 평가는 최고 등급 3개 이상일 때만", () => {
    const base = groupStats(sample().games.genshin, "genshin", "genshin-char");
    expect(luckLabel(base)).toBeNull();
    expect(luckLabel({ ...base, tops: 3, pityRatio: 0.4 })).toBe("운이 아주 좋음");
    expect(luckLabel({ ...base, tops: 3, pityRatio: 0.6 })).toBe("운이 좋은 편");
    expect(luckLabel({ ...base, tops: 3, pityRatio: 0.8 })).toBe("보통");
    expect(luckLabel({ ...base, tops: 3, pityRatio: 0.95 })).toBe("천장 근처에서 자주 나옴");
  });
});
