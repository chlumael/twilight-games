import { describe, expect, it } from "vitest";
import { GAMES } from "./games";
import { dayStart, emptyPlan, forecast, monthStartsUntil, PASSES, passOn, projectIncome, ROUTINES, weekdaysUntil } from "./income";
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
  it("공월을 켜면 목표일까지 남은 날 × 90 (오늘 몫은 받았다고 봄), 게임 안 최대 기간과 상관없이", () => {
    const plan = { ...emptyPlan(), routine: false, passes: { welkin: true } };
    expect(projectIncome("genshin", plan, target, now).gains).toEqual({ primogem: 900 });
    const far = dayStart("2027-11-26"); // 1년 뒤 (게임 안 최대 180일보다 길어도 그대로 센다)
    expect(projectIncome("genshin", plan, far, now).gains.primogem).toBe(365 * 90);
    expect(projectIncome("genshin", { ...plan, passes: { welkin: false } }, target, now).gains).toEqual({});
  });
  it("예전 형식(월정액 끝나는 날)은 그날이 오늘 뒤면 켠 것으로 읽는다", () => {
    expect(passOn({ target: null, until: { welkin: "2026-12-31" } }, "welkin", now)).toBe(true);
    expect(passOn({ target: null, until: { welkin: "2026-11-20" } }, "welkin", now)).toBe(false);
    expect(passOn({ target: null, until: { welkin: "2026-12-31" }, passes: { welkin: false } }, "welkin", now)).toBe(false);
  });
  it("주간·매달 횟수: 오늘 다음 날부터 목표일까지 그 요일·1일이 몇 번 오는지", () => {
    const from = dayStart("2026-11-26"); // 목요일
    expect(weekdaysUntil(dayStart("2026-12-06"), from, 1)).toBe(1); // 11/30 월
    expect(weekdaysUntil(dayStart("2026-12-07"), from, 1)).toBe(2); // + 12/7 월
    expect(monthStartsUntil(dayStart("2027-01-01"), from)).toBe(2); // 12/1, 1/1
  });
  it("일일 과제 데이터의 재화 이름은 그 게임 재화만", () => {
    for (const [g, list] of Object.entries(ROUTINES)) {
      const keys = new Set(GAMES[g as keyof typeof GAMES].currencies.map((c) => c.key));
      for (const r of list) for (const part of [r.daily, r.weekly, r.monthly]) for (const k of Object.keys(part ?? {})) expect(keys.has(k), `${g} ${r.id} ${k}`).toBe(true);
    }
  });
  it("원신 캐릭터: 지금/목표일 가능 횟수, 천장·픽업 확정(픽뚫까지)까지 필요 횟수", () => {
    let r = emptyRecords();
    r.games.genshin.currency = { primogem: 1600, intertwined: 5 };
    r = recordSession(r, "genshin", "genshin-char", 10, new Map(), now); // 인연 5 + 원석 800 사용
    const plan = { ...emptyPlan(), routine: false, passes: { welkin: true } };
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
    expect(f.bonus).toEqual({ label: "긴급 모집", pulls: 10, remaining: 10 }); // 20회 뽑음 → 10회 더 뽑으면 무료 10회
  });
  it("일일·주간 과제: 엔드필드 10일(월요일 1번) = 200×10 + 500, 명일방주는 섬멸 포함, 림버스는 목요일 주간만", () => {
    const plan = { ...emptyPlan(), routine: true };
    expect(projectIncome("endfield", plan, target, now).gains).toEqual({ oroberyl: 2500 });
    expect(projectIncome("arknights", plan, target, now).gains).toEqual({ orundum: 1000 + 500 + 1800 });
    expect(projectIncome("limbus", plan, target, now).gains).toEqual({ lunacy: 750 }); // 12/3 목요일 1번
    expect(projectIncome("genshin", { ...plan, routine: false }, target, now).gains).toEqual({});
  });
});
