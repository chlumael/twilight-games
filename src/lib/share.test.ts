import { describe, expect, it } from "vitest";
import { emptyRecords, recordSession } from "./ledger";
import { buildSummary, luckText, newGroupCode, ranking, validCode } from "./share";

const t = (min: number) => new Date(Date.UTC(2026, 10, 24, 12, min));

describe("친구 공유 요약", () => {
  it("게임별 뽑기·최고 등급·최근 기록만, 재화·확인 대기는 올리지 않는다", () => {
    let r = emptyRecords();
    r.games.genshin.currency = { primogem: 99999 };
    r = recordSession(r, "genshin", "genshin-char", 80, new Map([[79, { name: "자백", featured: true }]]), t(0));
    r.games.genshin.pulls.push({ ...r.games.genshin.pulls[0], id: "p", status: "pending", top: true, name: "대기" });
    const s = buildSummary(r, "  친구A  ", ["genshin", "limbus"], t(5));
    expect(s.nickname).toBe("친구A");
    expect(s.games.limbus).toBeUndefined();
    expect(s.games.genshin).toMatchObject({ pulls: 80, tops: 1 });
    expect(s.games.genshin?.recent).toEqual([{ name: "자백", count: 80, featured: true, day: "2026-11-24", group: "캐릭터" }]);
    expect(JSON.stringify(s)).not.toContain("99999");
    expect(JSON.stringify(s)).not.toContain("대기");
  });
  it("순위: 운(상위 %)이 작을수록 위, 운을 모르면 아래, 최고 등급 3개 미만은 표본 부족", () => {
    const mk = (name: string, luck: number | null, pulls: number, tops: number) => ({
      uid: name, summary: { nickname: name, updatedAt: "", manualShare: 0, games: { genshin: { pulls, tops, average: null, luck, groups: [], recent: [] } } },
    });
    const rows = ranking([mk("가", 40, 100, 2), mk("나", 10, 300, 5), mk("다", null, 50, 0)], "가", "genshin");
    expect(rows.map((r) => r.nickname)).toEqual(["나", "가", "다"]);
    expect(rows[1]).toMatchObject({ me: true, fewSamples: true });
    expect(luckText(10)).toBe("상위 10%");
    expect(luckText(80)).toBe("하위 20%");
  });
  it("초대 코드는 헷갈리는 글자 없이 10자리", () => {
    const c = newGroupCode();
    expect(validCode(c)).toBe(true);
    expect(validCode("ABCDE1O0IL")).toBe(false);
    expect(validCode(c.toLowerCase())).toBe(true);
  });
});
