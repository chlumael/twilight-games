import { describe, expect, it } from "vitest";
import { GAMES } from "./games";
import { dayStart, emptyPlan, forecast, PASSES, projectIncome } from "./income";
import { emptyRecords, recordSession, syncPityFromScreen } from "./ledger";

const now = new Date(2026, 10, 26, 15, 0); // 2026-11-26 오후
const target = dayStart("2026-12-06"); // 10일 뒤

describe("재화 예측", () => {
  it("월정액 데이터의 재화 이름은 그 게임 재화만", () => {
    for (const [g, list] of Object.entries(PASSES)) {
      const keys = new Set(GAMES[g as keyof typeof GAMES].currencies.map((c) => c.key));
      for (const p of list) for (const k of Object.keys(p.daily)) expect(keys.has(k), `${g} ${p.id} ${k}`).toBe(true);
    }
  });
  it("공월: 목표일까지 남은 날 × 90 (오늘 몫은 받았다고 봄), 끝나는 날이 먼저면 거기까지", () => {
    const plan = { ...emptyPlan(), until: { welkin: "2026-12-31" } };
    expect(projectIncome("genshin", plan, target, now).gains).toEqual({ primogem: 900 });
    const short = { ...emptyPlan(), until: { welkin: "2026-11-30" } };
    expect(projectIncome("genshin", short, target, now).gains).toEqual({ primogem: 360 });
  });
  it("직접 입력한 하루 수입도 더한다", () => {
    const plan = { ...emptyPlan(), extraDaily: { oroberyl: 100 } };
    expect(projectIncome("endfield", plan, target, now).gains).toEqual({ oroberyl: 1000 });
  });
  it("원신 캐릭터: 지금/목표일 가능 횟수, 천장·픽업 확정(픽뚫까지)까지 필요 횟수", () => {
    let r = emptyRecords();
    r.games.genshin.currency = { primogem: 1600, intertwined: 5 };
    r = recordSession(r, "genshin", "genshin-char", 10, new Map(), now); // 인연 5 + 원석 800 사용
    const plan = { ...emptyPlan(), until: { welkin: "2026-12-31" } };
    const f = forecast(r.games.genshin, "genshin", "genshin-char", plan, target, now);
    expect(f.nowPulls).toBe(5);       // 원석 800
    expect(f.laterPulls).toBe(10);    // 원석 1700
    expect(f.toTop).toBe(80);
    expect(f.toFeatured).toBe(170);   // 픽뚫이면 한 바퀴 더
  });
  it("엔드필드 한정: 픽업 확정은 120 카운터 기준", () => {
    let r = emptyRecords();
    r = syncPityFromScreen(r, "endfield", "endfield-chartered", 53, 100);
    const f = forecast(r.games.endfield, "endfield", "endfield-chartered", emptyPlan(), target, now);
    expect(f.toTop).toBe(53);
    expect(f.toFeatured).toBe(100);
  });
});
