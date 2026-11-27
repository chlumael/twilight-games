import { describe, expect, it } from "vitest";
import { GAMES } from "./games";
import {
  availablePulls,
  pullsFrom,
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
    expect(s.counters[0]).toMatchObject({ label: "교환(데이터 계약)", remaining: 300 });
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

  it("Limbus spends tickets before Lunacy", () => {
    const spend = GAMES.limbus.groups[0].spend;
    expect(deduct({ tenTicket: 1, ticket: 2, lunacy: 1300 }, spend, 10).currency).toEqual({ tenTicket: 0, ticket: 2, lunacy: 1300 });
    expect(deduct({ tenTicket: 0, ticket: 2, lunacy: 1300 }, spend, 10).currency).toEqual({ tenTicket: 0, ticket: 0, lunacy: 260 });
  });

  it("Genshin spends fates, then primogems, then converts Genesis Crystals", () => {
    const spend = GAMES.genshin.groups[0].spend;
    const cur = { intertwined: 1, primogem: 100, genesis: 300 };
    expect(availablePulls(cur, spend)).toBe(3); // 1 fate + (100+300)/160
    expect(pullsFrom(cur, spend, "genesis")).toBe(2);
    expect(deduct(cur, spend, 2).currency).toEqual({ intertwined: 0, primogem: 0, genesis: 240 });
    expect(spendPreview(cur, spend, 2).items).toEqual([
      { key: "intertwined", amount: 1 }, { key: "primogem", amount: 100 }, { key: "genesis", amount: 60 },
    ]);
    expect(deduct(cur, spend, 4).shortfall).toBe(1);
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
    // 픽업까지: 74뽑 픽뚫 + 16뽑 픽업 = 90 (사용자 2026-11-27)
    expect(topHistory(r.games.genshin, "genshin-char").map((h) => h.toFeatured)).toEqual([null, 90]);
  });
  it("픽업까지 횟수: 바로 픽업이면 그 횟수, 픽업인지 모르는 기록이 끼면 모름, 시작이 확정 상태면 모름", () => {
    let r = emptyRecords();
    r = recordSession(r, "genshin", "genshin-char", 10, new Map([[4, { name: "A", featured: true }]]), t(0));
    r = recordSession(r, "genshin", "genshin-char", 10, new Map([[2, { name: null, featured: null }]]), t(1));
    r = recordSession(r, "genshin", "genshin-char", 10, new Map([[1, { name: "B", featured: true }]]), t(2));
    r = recordSession(r, "genshin", "genshin-char", 10, new Map([[0, { name: "C", featured: true }]]), t(3));
    expect(topHistory(r.games.genshin, "genshin-char").map((h) => [h.count, h.toFeatured])).toEqual([[5, 5], [8, null], [9, null], [9, 9]]);
    let g = emptyRecords();
    g.games.genshin.baseline["genshin-char"] = { ...emptyBaseline(), pity: 10, guaranteed: true };
    g = recordSession(g, "genshin", "genshin-char", 10, new Map([[4, { name: "B", featured: true }]]), t(0));
    expect(topHistory(g.games.genshin, "genshin-char")[0].toFeatured).toBeNull();
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

import { recordDetected } from "./ledger";

describe("화면 감지 기록", () => {
  it("최고 등급은 맨 뒤 자리, 4성·3성은 이름과 등급, 재화는 화면 값으로", () => {
    let r = emptyRecords();
    r.games.genshin.currency = { primogem: 1600, intertwined: 10 };
    r = recordDetected(r, "genshin", "genshin-char", 10, [
      { name: "바바라", rarity: 4, top: false, featured: null },
      { name: "자백", rarity: 5, top: true, featured: true },
      { name: "탄궁", rarity: 3, top: false, featured: null },
    ], { primogem: 1600, intertwined: 0 }, t(0));
    const pulls = r.games.genshin.pulls.sort((a, b) => a.indexInSession - b.indexInSession);
    expect(pulls).toHaveLength(10);
    expect(pulls[9]).toMatchObject({ top: true, name: "자백", featured: true, rarity: 5, source: "screen" });
    expect(pulls[0]).toMatchObject({ name: "바바라", rarity: 4, top: false });
    expect(pulls[1]).toMatchObject({ name: "탄궁", rarity: 3 });
    expect(pulls[2].name).toBeNull();
    expect(r.games.genshin.currency).toEqual({ primogem: 1600, intertwined: 0 });
    expect(groupStatus(r.games.genshin, "genshin", "genshin-char").pity).toBe(0);
  });
});

import { inferTopFromScreen, syncPityFromScreen } from "./ledger";

describe("화면에 적힌 남은 횟수로 천장 맞추기", () => {
  const status = (r: ReturnType<typeof emptyRecords>) => groupStatus(r.games.endfield, "endfield", "endfield-chartered");
  it("기록이 없어도 화면 값으로 맞춘다 (80회 중 53회 남음 = 27회 쌓임, 120회 중 100회 남음)", () => {
    const r = syncPityFromScreen(emptyRecords(), "endfield", "endfield-chartered", 53, 100);
    expect(status(r).pity).toBe(27);
    expect(status(r).counters[0].remaining).toBe(100);
  });
  it("앱이 센 값과 다르면 차이만큼 고치고, 같으면 그대로 둔다", () => {
    let r = recordSession(emptyRecords(), "endfield", "endfield-chartered", 10, new Map(), t(0));
    r = syncPityFromScreen(r, "endfield", "endfield-chartered", 43, 90);
    expect(status(r).pity).toBe(37);
    expect(status(r).counters[0].remaining).toBe(90);
    expect(r.games.endfield.pulls.length).toBe(10); // 뽑기 기록은 그대로
    expect(syncPityFromScreen(r, "endfield", "endfield-chartered", 43, 90)).toBe(r);
    // 이후 10회를 더 기록하면 화면 값과 같이 움직인다
    r = recordSession(r, "endfield", "endfield-chartered", 10, new Map(), t(5));
    expect(status(r).pity).toBe(47);
    expect(syncPityFromScreen(r, "endfield", "endfield-chartered", 33, 80)).toBe(r);
  });
  it("말이 안 되는 값은 무시한다", () => {
    const r = emptyRecords();
    expect(syncPityFromScreen(r, "endfield", "endfield-chartered", 530, null)).toBe(r);
    expect(syncPityFromScreen(r, "endfield", "endfield-chartered", null, null)).toBe(r);
  });
});

describe("엔드필드 무기고", () => {
  const spend = GAMES.endfield.groups.find((g) => g.id === "endfield-arsenal")!.spend;
  it("10회 단위로만 센다 (무기고 증표 1980 = 10회)", () => {
    expect(availablePulls({ arsenalTicket: 4000 }, spend)).toBe(20);
    expect(availablePulls({ arsenalTicket: 1979 }, spend)).toBe(0);
    expect(deduct({ arsenalTicket: 4000 }, spend, 10).currency.arsenalTicket).toBe(2020);
    expect(deduct({ arsenalTicket: 4000 }, spend, 1).shortfall).toBe(1);
  });
  it("40회 천장, 80회 픽업 확정", () => {
    let r = emptyRecords();
    r.games.endfield.currentBanner["endfield-arsenal"] = "테스트 무기고";
    r = recordSession(r, "endfield", "endfield-arsenal", 10, new Map(), t(0));
    const st = groupStatus(r.games.endfield, "endfield", "endfield-arsenal");
    expect(st.hardPity).toBe(40);
    expect(st.pity).toBe(10);
    expect(st.counters[0]).toMatchObject({ at: 80, remaining: 70 });
  });
});

describe("화면 천장 숫자로 최고 등급 나온 자리 찾기", () => {
  const G = "endfield-chartered";
  const status = (r: ReturnType<typeof emptyRecords>) => groupStatus(r.games.endfield, "endfield", G);
  it("10회 뽑고 화면이 '77회 내 6성'으로 바뀌면 = 3회 전에 6성(픽업 문구가 남아 있으니 픽뚫)", () => {
    let r = syncPityFromScreen(emptyRecords(), "endfield", G, 53, 100); // 27회 쌓임
    r = recordSession(r, "endfield", G, 10, new Map(), t(0));
    expect(status(r).pity).toBe(37);
    r = inferTopFromScreen(r, "endfield", G, 77, 90, t(1));
    const session = r.games.endfield.pulls.filter((p) => p.group === G);
    const top = session.find((p) => p.top)!;
    expect(top.indexInSession).toBe(6);
    expect(top.featured).toBe(false);
    expect(status(r).pity).toBe(3);
    expect(syncPityFromScreen(r, "endfield", G, 77, 90)).toBe(r); // 이미 맞음
    expect(inferTopFromScreen(r, "endfield", G, 77, 90, t(1))).toBe(r); // 두 번 붙이지 않음
  });
  it("천장이 그대로 늘었거나, 오래전 묶음이면 손대지 않는다", () => {
    let r = recordSession(emptyRecords(), "endfield", G, 10, new Map(), t(0));
    expect(inferTopFromScreen(r, "endfield", G, 70, 110, t(1))).toBe(r); // 10회 쌓임 = 정상
    r = recordSession(r, "endfield", G, 10, new Map(), t(0));
    expect(inferTopFromScreen(r, "endfield", G, 78, 100, t(50))).toBe(r); // 50분 지남
  });
});

import { recordResult, resetPity, syncBannerPulls } from "./ledger";

describe("결과 화면 기록·화면 값 맞추기", () => {
  it("결과 화면 10회: 6성 자리를 표시하고 출처는 화면", () => {
    const r = recordResult(emptyRecords(), "endfield", "endfield-chartered", 10, [6], t(0));
    const pulls = r.games.endfield.pulls;
    expect(pulls.filter((p) => p.top).map((p) => p.indexInSession)).toEqual([6]);
    expect(pulls.every((p) => p.source === "screen")).toBe(true);
    expect(groupStatus(r.games.endfield, "endfield", "endfield-chartered").pity).toBe(3);
  });
  it("배너 누적 횟수(림버스 200회 교환)를 화면 값에 맞춘다", () => {
    let r = emptyRecords();
    r.games.limbus.currentBanner["limbus-extraction"] = "배너A";
    r = recordSession(r, "limbus", "limbus-extraction", 10, new Map(), t(0));
    r = syncBannerPulls(r, "limbus", "limbus-extraction", 57);
    expect(groupStatus(r.games.limbus, "limbus", "limbus-extraction").bannerPulls).toBe(57);
    expect(syncBannerPulls(r, "limbus", "limbus-extraction", 57)).toBe(r);
  });
  it("천장 스택 0부터 다시 (명일방주 일반 배너를 이어가지 않을 때)", () => {
    let r = recordSession(emptyRecords(), "arknights", "arknights-standard", 30, new Map(), t(0));
    r = resetPity(r, "arknights", "arknights-standard");
    expect(groupStatus(r.games.arknights, "arknights", "arknights-standard").pity).toBe(0);
    r = recordSession(r, "arknights", "arknights-standard", 10, new Map(), t(1));
    expect(groupStatus(r.games.arknights, "arknights", "arknights-standard").pity).toBe(10);
  });
  it("이월 안 되는 무기고도 화면 천장 값에 맞춰지고, 다시 맞출 때 그대로", () => {
    let r = emptyRecords();
    r.games.endfield.currentBanner["endfield-arsenal"] = "무기고A";
    r = syncPityFromScreen(r, "endfield", "endfield-arsenal", 30, null);
    expect(groupStatus(r.games.endfield, "endfield", "endfield-arsenal").pity).toBe(10);
    expect(syncPityFromScreen(r, "endfield", "endfield-arsenal", 30, null)).toBe(r);
  });
});

describe("엔드필드 재구축: 80 천장은 재구축끼리 공유, 120·누적은 같은 이름(시리즈)끼리", () => {
  it("공식 규칙대로 센다", async () => {
    const { setSeriesOf } = await import("./ledger");
    let r = emptyRecords();
    r.games.endfield.currentBanner["endfield-refactor"] = "A1";
    r = recordSession(r, "endfield", "endfield-refactor", 30, new Map(), t(0));
    r.games.endfield.currentBanner["endfield-refactor"] = "B1"; // 다른 이름의 재구축
    let st = groupStatus(r.games.endfield, "endfield", "endfield-refactor");
    expect(st.pity).toBe(30); // 80 천장은 이어짐
    expect(st.bannerPulls).toBe(0); // 120·누적은 새로
    setSeriesOf((id) => id.replace(/\d+$/, ""));
    r.games.endfield.currentBanner["endfield-refactor"] = "A2"; // 같은 이름 #2
    st = groupStatus(r.games.endfield, "endfield", "endfield-refactor");
    expect(st.bannerPulls).toBe(30);
    expect(st.counters[0].remaining).toBe(90);
    setSeriesOf((id) => id);
  });
  it("명일방주 일반(표준 헤드헌팅)은 배너가 바뀌어도 확률 상승 횟수가 이어지고, 한정·콜라보는 배너마다 새로", () => {
    let r = emptyRecords();
    for (const g of ["arknights-standard", "arknights-limited", "arknights-collab"]) {
      r.games.arknights.currentBanner[g] = "A";
      r = recordSession(r, "arknights", g, 20, new Map(), t(0));
      r.games.arknights.currentBanner[g] = "B";
    }
    const pity = (g: string) => groupStatus(r.games.arknights, "arknights", g).pity;
    expect([pity("arknights-standard"), pity("arknights-limited"), pity("arknights-collab")]).toEqual([20, 0, 0]);
  });
});


describe("원신 무기: 고른 무기(신각의 길)", () => {
  it("픽업 무기라도 고른 무기가 아니면 다음 확정", () => {
    let r = emptyRecords();
    r.games.genshin.currentBanner["genshin-weapon"] = "W";
    r = recordSession(r, "genshin", "genshin-weapon", 1, new Map([[0, { name: "픽업B", featured: true }]]), t(0));
    expect(groupStatus(r.games.genshin, "genshin", "genshin-weapon").guaranteed).toBe(false);
    r.games.genshin.chosen = { "genshin-weapon": { banner: "W", name: "픽업A" } };
    expect(groupStatus(r.games.genshin, "genshin", "genshin-weapon").guaranteed).toBe(true);
    r.games.genshin.chosen = { "genshin-weapon": { banner: "W", name: "픽업B" } };
    expect(groupStatus(r.games.genshin, "genshin", "genshin-weapon").guaranteed).toBe(false);
  });
});

describe("기록 묶음 정리", () => {
  it("묶음 목록을 보여 주고, 지우면 되돌릴 수 있다", async () => {
    const { pullBatches, removeBatches, recordDetected } = await import("./ledger");
    let r = recordSession(emptyRecords(), "endfield", "endfield-chartered", 10, new Map([[3, { name: "케르", featured: true }]]), t(0));
    r = recordDetected(r, "endfield", "endfield-chartered", 99, [], {}, t(5)); // 잘못 감지된 묶음
    const batches = pullBatches(r.games.endfield);
    expect(batches.map((b) => [b.count, b.source, b.tops])).toEqual([[99, "screen", []], [10, "manual", ["케르"]]]);
    const cut = removeBatches(r, "endfield", [batches[0].sessionId], "정리");
    expect(cut.games.endfield.pulls).toHaveLength(10);
    expect(undo(cut).records.games.endfield.pulls).toHaveLength(109);
  });
});

describe("천장 표시 (반천/확천)", () => {
  it("엔드필드: 80회째 = 반천, 120회째 픽업 = 확천, 그 전은 표시 없음", async () => {
    const { hitLabel } = await import("./ledger");
    let r = emptyRecords();
    r.games.endfield.currentBanner["endfield-chartered"] = "B";
    r = recordSession(r, "endfield", "endfield-chartered", 80, new Map([[79, { name: "엠버", featured: false }]]), t(0));
    r = recordSession(r, "endfield", "endfield-chartered", 40, new Map([[39, { name: "케르", featured: true }]]), t(1));
    r = recordSession(r, "endfield", "endfield-chartered", 10, new Map([[4, { name: "케르", featured: true }]]), t(2));
    expect(topHistory(r.games.endfield, "endfield-chartered").map((h) => [h.count, hitLabel(h)]))
      .toEqual([[80, "픽뚫/반천"], [40, "픽업/확천"], [5, "픽업"]]);
    // 확률 상승 구간(66회~)에서 나온 것도 반천
    const soft = recordSession(emptyRecords(), "endfield", "endfield-chartered", 70, new Map([[69, { name: "엠버", featured: false }]]), t(0));
    expect(topHistory(soft.games.endfield, "endfield-chartered").map(hitLabel)).toEqual(["픽뚫/반천"]);
  });
  it("원신: 확정 상태에서 90회째 = 확천, 50:50 상태에서 90회째 = 반천", async () => {
    const { hitLabel } = await import("./ledger");
    let r = recordSession(emptyRecords(), "genshin", "genshin-char", 90, new Map([[89, { name: "치치", featured: false }]]), t(0));
    r = recordSession(r, "genshin", "genshin-char", 90, new Map([[89, { name: "자백", featured: true }]]), t(1));
    expect(topHistory(r.games.genshin, "genshin-char").map(hitLabel)).toEqual(["픽뚫/반천", "픽업/확천"]);
  });
});

describe("교환(확천)", () => {
  it("림버스: 추출 200회로 교환 가능, 교환하면 200만큼 줄고 뽑기 수는 그대로", async () => {
    const { recordExchange } = await import("./ledger");
    let r = emptyRecords();
    r.games.limbus.currentBanner["limbus-extraction"] = "B";
    r = recordSession(r, "limbus", "limbus-extraction", 230, new Map(), t(0));
    const st = () => groupStatus(r.games.limbus, "limbus", "limbus-extraction");
    expect(st().counters[0]).toMatchObject({ remaining: 0, done: true });
    r = recordExchange(r, "limbus", "limbus-extraction", "픽업 인격", t(1));
    expect(st().counters[0]).toMatchObject({ remaining: 170, done: false });
    expect(r.games.limbus.pulls).toHaveLength(230);
  });
  it("엔드필드 긴급 모집(무료)에서 나온 6성: 천장·누적 횟수·허가증은 그대로, 무기고 징표만 2000", async () => {
    const { recordFreeTop, removeExchange } = await import("./ledger");
    let r = emptyRecords();
    r.games.endfield.currentBanner["endfield-chartered"] = "B";
    r.games.endfield.currency = { oroberyl: 5000, charteredPermit: 3, arsenalTicket: 100 };
    r = recordSession(r, "endfield", "endfield-chartered", 40, new Map(), t(0));
    const before = groupStatus(r.games.endfield, "endfield", "endfield-chartered");
    const cur = { ...r.games.endfield.currency };
    r = recordFreeTop(r, "endfield", "endfield-chartered", { name: "명하", featured: false }, t(1));
    const after = groupStatus(r.games.endfield, "endfield", "endfield-chartered");
    expect([after.pity, after.bannerPulls]).toEqual([before.pity, before.bannerPulls]);
    expect(after.counters).toEqual(before.counters);
    expect(r.games.endfield.currency).toEqual({ ...cur, arsenalTicket: cur.arsenalTicket + 2000 });
    expect(r.games.endfield.exchanges?.[0]).toMatchObject({ kind: "free", name: "명하", featured: false, banner: "B" });
    // 지우면 징표도 되돌린다
    r = removeExchange(r, "endfield", r.games.endfield.exchanges![0].id);
    expect(r.games.endfield.currency.arsenalTicket).toBe(cur.arsenalTicket);
    // 무료 뽑기가 없는 종류에는 기록하지 않는다
    expect(recordFreeTop(r, "limbus", "limbus-extraction", { name: "가", featured: null }, t(2))).toBe(r);
  });
  it("엔드필드 다음 한정 배너로 넘어갈 때: 배너 전용 허가증은 사라지고, 60회를 채웠으면 정보서로 10장", async () => {
    const { carryToNextBanner } = await import("./ledger");
    const start = (pulls: number, permit: number) => {
      let r = emptyRecords();
      r.games.endfield.currentBanner["endfield-chartered"] = "A";
      r.games.endfield.currency = { oroberyl: 100000, limitedPermit: 0, charteredPermit: 4 };
      if (pulls) r = recordSession(r, "endfield", "endfield-chartered", pulls, new Map(), t(0));
      r.games.endfield.currency.limitedPermit = permit;
      return r;
    };
    // 60회 이상 뽑고 전용 허가증 3장을 남김 → 3장 소멸 + 정보서 10장
    let out = carryToNextBanner(start(60, 3), "endfield", "endfield-chartered");
    const before = start(60, 3).games.endfield.currency;
    expect(out.records.games.endfield.currency).toEqual({ ...before, limitedPermit: 10 }); // 다른 재화는 그대로
    expect(out.notes).toEqual(["배너 전용 헤드헌팅 허가증 3개 소멸", "배너 전용 헤드헌팅 허가증 +10"]);
    // 59회면 정보서가 없다
    out = carryToNextBanner(start(59, 3), "endfield", "endfield-chartered");
    expect(out.records.games.endfield.currency.limitedPermit).toBe(0);
    // 규칙이 없는 종류는 그대로
    const r = start(60, 3);
    expect(carryToNextBanner(r, "endfield", "endfield-refactor").records).toBe(r);
    expect(carryToNextBanner(r, "genshin", "genshin-char").records).toBe(r);
  });
  it("명일방주 교환 가격: 오래된 한정 200장, 5성 75장은 그만큼만 줄어든다", async () => {
    const { recordExchange } = await import("./ledger");
    let r = emptyRecords();
    const L = "arknights-limited";
    r.games.arknights.currentBanner[L] = "B";
    r = recordSession(r, "arknights", L, 300, new Map(), t(0));
    const st = () => groupStatus(r.games.arknights, "arknights", L).counters[0];
    expect(st()).toMatchObject({ held: 300, remaining: 0 });
    r = recordExchange(r, "arknights", L, null, t(1), { cost: 75, low: true });
    expect(st()).toMatchObject({ held: 225, remaining: 75 });
    r = recordExchange(r, "arknights", L, "W", t(2), { cost: 200 });
    expect(st()).toMatchObject({ held: 25, remaining: 275 });
    expect(r.games.arknights.exchanges?.[0]).toMatchObject({ low: true, cost: 75 });
  });
  it("명일방주: 콜라보는 120회 픽업 확정, 51회부터 반천", async () => {
    const { hitLabel } = await import("./ledger");
    let r = emptyRecords();
    r.games.arknights.currentBanner["arknights-collab"] = "C";
    r = recordSession(r, "arknights", "arknights-collab", 60, new Map([[59, { name: "가", featured: false }]]), t(0));
    r = recordSession(r, "arknights", "arknights-collab", 60, new Map([[59, { name: "나", featured: true }]]), t(1));
    expect(topHistory(r.games.arknights, "arknights-collab").map(hitLabel)).toEqual(["픽뚫/반천", "픽업/확천"]);
  });
});

describe("검수에서 찾은 문제", () => {
  it("이월 안 되는 종류는 배너가 바뀌면 최고 등급 횟수도 새로 센다", () => {
    let r = emptyRecords();
    r.games.arknights.currentBanner["arknights-limited"] = "A";
    r = recordSession(r, "arknights", "arknights-limited", 40, new Map(), t(0));
    r.games.arknights.currentBanner["arknights-limited"] = "B";
    r = recordSession(r, "arknights", "arknights-limited", 10, new Map([[9, { name: "가", featured: true }]]), t(1));
    expect(topHistory(r.games.arknights, "arknights-limited").map((h) => h.count)).toEqual([10]);
  });
  it("무기 신청: 묶음 안에서 6성이 나오면 천장은 0부터", () => {
    let e = emptyRecords();
    e.games.endfield.currentBanner["endfield-arsenal"] = "W";
    e = recordSession(e, "endfield", "endfield-arsenal", 40, new Map([[35, { name: "무기", featured: false }]]), t(0));
    expect(groupStatus(e.games.endfield, "endfield", "endfield-arsenal").pity).toBe(0);
  });
});

describe("기준값이 음수로 남는 문제 (−64뽑)", () => {
  it("잘못된 기록을 화면 값으로 맞춘 뒤 지워도 횟수·천장이 음수가 되지 않는다", async () => {
    const { removeBatches, pullBatches, recordDetected, repairBaselines } = await import("./ledger");
    const G = "endfield-chartered";
    let r = recordDetected(emptyRecords(), "endfield", G, 99, [], {}, t(0)); // 잘못 감지된 99회
    r = syncPityFromScreen(r, "endfield", G, 55, null); // 화면: 25스택 → 기준값 −74
    expect(r.games.endfield.baseline[G].pity).toBe(-74);
    r = recordSession(r, "endfield", G, 10, new Map([[9, { name: "포그라니치니크", featured: false }]]), t(5));
    const bad = pullBatches(r.games.endfield).find((b) => b.count === 99)!;
    r = removeBatches(r, "endfield", [bad.sessionId], "정리");
    expect(topHistory(r.games.endfield, G).map((h) => h.count)).toEqual([10]);
    expect(groupStatus(r.games.endfield, "endfield", G).pity).toBe(0);
    expect(repairBaselines(r)).toBe(r);
    // 이미 음수로 저장된 기록도 고친다
    const broken = structuredClone(r);
    broken.games.endfield.pulls = broken.games.endfield.pulls.filter((p) => !p.top);
    broken.games.endfield.baseline[G].pity = -74;
    expect(groupStatus(repairBaselines(broken).games.endfield, "endfield", G).pity).toBe(0);
    expect(repairBaselines(broken).games.endfield.baseline[G].pity).toBe(-9);
  });
});



describe("직접 입력: 이 배너에서 n번째에 최고 등급 (배너 누적)", () => {
  const G = "endfield-chartered";
  const st = (r: ReturnType<typeof emptyRecords>) => groupStatus(r.games.endfield, "endfield", G);
  it("16 → 58 → 92 → 120 순서로 넣으면 총 120회, 횟수는 16·42·34·28, 120번째 픽업은 확천", async () => {
    const { recordTopAt, hitLabel } = await import("./ledger");
    let r = emptyRecords();
    r.games.endfield.currentBanner[G] = "B";
    for (const [n, name, featured] of [[16, "포그라니치니크", false], [58, "사", false], [92, "아델리아", false], [120, "케르", true]] as const) {
      const out = recordTopAt(r, "endfield", G, n, { name, featured }, t(n));
      expect(out.mode).toBe("added");
      r = out.records;
    }
    expect(r.games.endfield.pulls).toHaveLength(120);
    expect(topHistory(r.games.endfield, G).map((h) => [h.count, hitLabel(h)])).toEqual([[16, "픽뚫"], [42, "픽뚫"], [34, "픽뚫"], [28, "픽업/확천"]]);
    expect(st(r)).toMatchObject({ pity: 0, bannerPulls: 120 });
    expect(r.games.endfield.currency).toEqual({}); // 직접 입력은 보유 재화를 깎지 않는다
    expect(topHistory(r.games.endfield, G).map((h) => h.at)).toEqual([16, 58, 92, 120]);
  });
  it("이미 기록된 뽑기 자리면 그 자리를 표시한다", async () => {
    const { recordTopAt } = await import("./ledger");
    let r = emptyRecords();
    r.games.endfield.currentBanner[G] = "B";
    r = recordSession(r, "endfield", G, 30, new Map(), t(0));
    const out = recordTopAt(r, "endfield", G, 17, { name: "가", featured: null }, t(1));
    expect(out.mode).toBe("marked");
    expect(out.records.games.endfield.pulls).toHaveLength(30);
    expect(st(out.records).pity).toBe(13);
  });
  it("천장을 넘게 건너뛰면 받지 않는다 (그 사이 6성을 먼저 넣어야 함)", async () => {
    const { recordTopAt } = await import("./ledger");
    const r = emptyRecords();
    r.games.endfield.currentBanner[G] = "B";
    expect(recordTopAt(r, "endfield", G, 120, { name: "케르", featured: true }, t(0))).toMatchObject({ mode: "too-far", records: r });
  });
  it("엔드필드 무기고는 10의 배수로: 9 → 10번째, 58 → 60번째", async () => {
    const { recordTopAt } = await import("./ledger");
    const A = "endfield-arsenal";
    let r = emptyRecords();
    r.games.endfield.currentBanner[A] = "W";
    r = recordTopAt(r, "endfield", A, 9, { name: "무기1", featured: false }, t(0)).records;
    expect(r.games.endfield.pulls).toHaveLength(10);
    const far = recordTopAt(r, "endfield", A, 58, { name: "무기2", featured: true }, t(1));
    expect(far.mode).toBe("too-far"); // 10 → 60은 50개 = 4번째 신청 천장(40)을 넘음
    r = recordTopAt(r, "endfield", A, 50, { name: "무기2", featured: true }, t(1)).records;
    expect(topHistory(r.games.endfield, A).map((h) => h.count)).toEqual([10, 40]);
    r = recordSession(r, "endfield", A, 12, new Map(), t(2));
    expect(groupStatus(r.games.endfield, "endfield", A).pity).toBe(20);
  });
});

describe("직접 입력: 횟수만 맞추기", () => {
  it("무기고 10번째·50번째 6성 뒤 60번째까지 뽑았다 → 총 60, 천장 10", async () => {
    const { recordTopAt, recordPullsTo, hitLabel } = await import("./ledger");
    const A = "endfield-arsenal";
    let r = emptyRecords();
    r.games.endfield.currentBanner[A] = "W";
    r = recordTopAt(r, "endfield", A, 10, { name: "무기1", featured: false }, t(0)).records;
    r = recordTopAt(r, "endfield", A, 50, { name: "무기2", featured: false }, t(1)).records;
    const out = recordPullsTo(r, "endfield", A, 58, t(2));
    expect(out.mode).toBe("added");
    expect(groupStatus(out.records.games.endfield, "endfield", A)).toMatchObject({ pity: 10, bannerPulls: 60 });
    expect(topHistory(out.records.games.endfield, A).map((h) => [h.count, hitLabel(h)])).toEqual([[10, "픽뚫"], [40, "픽뚫/반천"]]);
    expect(recordPullsTo(out.records, "endfield", A, 100, t(3)).mode).toBe("too-far");
    expect(recordPullsTo(out.records, "endfield", A, 30, t(3)).mode).toBe("invalid");
  });
});

describe("종류 초기화", () => {
  it("뽑기·시작 상태·교환을 비우고, 그 뒤 누적 입력이 0부터 시작한다", async () => {
    const { resetGroup, recordTopAt } = await import("./ledger");
    const G = "endfield-chartered";
    let r = recordSession(emptyRecords(), "endfield", G, 322, new Map(), t(0));
    r.games.endfield.baseline[G] = { ...emptyBaseline(), pity: -74, banner: "", bannerPulls: -202 };
    r = resetGroup(r, "endfield", G);
    expect(groupStatus(r.games.endfield, "endfield", G)).toMatchObject({ pity: 0, bannerPulls: 0 });
    expect(recordTopAt(r, "endfield", G, 52, { name: "가", featured: false }, t(1)).records.games.endfield.pulls).toHaveLength(52);
    expect(undo(r).records.games.endfield.pulls).toHaveLength(322);
  });
});

describe("바꿔서 쓰는 재화도 가능 횟수에 포함", () => {
  it("엔드필드: 오로베릴 7765 + 파생 오리지늄 140(×75) → 36회, 그중 21회가 파생 오리지늄", () => {
    const spend = GAMES.endfield.groups[0].spend;
    const cur = { oroberyl: 7765, origeometry: 140, charteredPermit: 0, limitedPermit: 0 };
    expect(availablePulls(cur, spend)).toBe(36);
    expect(pullsFrom(cur, spend, "origeometry")).toBe(21);
    // 10회 뽑으면 오로베릴부터 쓰고 모자란 만큼만 바꾼다
    expect(deduct(cur, spend, 20).currency).toMatchObject({ oroberyl: 15, origeometry: 110 });
  });
  it("명일방주: 합성옥 600 + 오리지늄 10(×180) → 4회", () => {
    const spend = GAMES.arknights.groups[0].spend;
    expect(availablePulls({ orundum: 600, originite: 10 }, spend)).toBe(4);
  });
});

describe("직접 입력은 보유 재화를 건드리지 않는다", () => {
  it("지난 뽑기를 적어도 오로베릴이 그대로", async () => {
    const { recordTopAt, recordPullsTo } = await import("./ledger");
    let r = emptyRecords();
    r.games.endfield.currency = { oroberyl: 7765, origeometry: 140 };
    r = recordTopAt(r, "endfield", "endfield-chartered", 52, { name: "가", featured: false }, t(0)).records;
    r = recordPullsTo(r, "endfield", "endfield-chartered", 60, t(1)).records;
    expect(r.games.endfield.currency).toEqual({ oroberyl: 7765, origeometry: 140 });
    expect(r.games.endfield.pulls).toHaveLength(60);
  });
});

describe("엔드필드: 오퍼레이터를 뽑으면 무기고 징표를 받는다", () => {
  const G = "endfield-chartered";
  it("10회에 6성 하나 → 2000 + 20×9, 나중에 6성으로 밝혀지면 차이만큼 더, 되돌리면 원래대로", () => {
    let r = emptyRecords();
    r.games.endfield.currency = { oroberyl: 10000, arsenalTicket: 100 };
    const a = recordSession(r, "endfield", G, 10, new Map([[3, { name: "케르", featured: true }]]), t(0));
    expect(a.games.endfield.currency.arsenalTicket).toBe(100 + 2000 + 180);
    const b = recordSession(r, "endfield", G, 10, new Map(), t(0));
    expect(b.games.endfield.currency.arsenalTicket).toBe(300);
    const c = markTopInLastSession(b, "endfield", G, 9, { name: null, featured: null });
    expect(c.games.endfield.currency.arsenalTicket).toBe(300 + 1980);
    expect(undo(c).records.games.endfield.currency.arsenalTicket).toBe(300);
  });
  it("지난 뽑기를 적는 직접 입력은 징표도 건드리지 않고, 무기고 뽑기는 징표를 주지 않는다", async () => {
    const { recordTopAt } = await import("./ledger");
    let r = emptyRecords();
    r.games.endfield.currency = { arsenalTicket: 5000 };
    expect(recordTopAt(r, "endfield", G, 52, { name: "가", featured: false }, t(0)).records.games.endfield.currency.arsenalTicket).toBe(5000);
    r = recordSession(r, "endfield", "endfield-arsenal", 10, new Map(), t(1));
    expect(r.games.endfield.currency.arsenalTicket).toBe(5000 - 1980);
  });
});

describe("원신 공식 기원 규칙", () => {
  const G = "genshin-char";
  /** 5성을 순서대로 넣는다: true = 픽업, false = 픽뚫 */
  const tops = (list: (boolean | null)[]) => {
    let r = emptyRecords();
    r.games.genshin.currentBanner[G] = "B";
    list.forEach((f, i) => { r = recordSession(r, "genshin", G, 1, new Map([[0, { name: `c${i}`, featured: f }]]), t(i)); });
    return groupStatus(r.games.genshin, "genshin", G);
  };
  it("별빛 포착: 픽뚫 → 확정 픽업이 3번 이어지면 그다음 5성은 픽업 확정", () => {
    expect(tops([false, true, false, true, false, true])).toMatchObject({ guaranteed: true, radiant: true });
    // 그 확정 픽업을 받으면 다시 50:50부터
    expect(tops([false, true, false, true, false, true, true])).toMatchObject({ guaranteed: false, radiant: false });
    expect(tops([false, true, false, true, false, true, true, false, true])).toMatchObject({ guaranteed: false, radiant: false });
  });
  it("별빛 포착: 2번까지는 그냥 50:50, 중간에 50:50을 이기면 처음부터 다시 센다", () => {
    expect(tops([false, true, false, true])).toMatchObject({ guaranteed: false, radiant: false });
    expect(tops([false, true, false, true, true, false, true])).toMatchObject({ guaranteed: false, radiant: false });
    expect(tops([false])).toMatchObject({ guaranteed: true, radiant: false });
  });
  it("확천 표시: 별빛 포착으로 확정된 픽업도 확천", async () => {
    const { hitLabel } = await import("./ledger");
    let r = emptyRecords();
    r.games.genshin.currentBanner[G] = "B";
    [false, true, false, true, false, true, true].forEach((f, i) => {
      r = recordSession(r, "genshin", G, 80, new Map([[79, { name: `c${i}`, featured: f }]]), t(i));
    });
    expect(topHistory(r.games.genshin, G).map(hitLabel).slice(-2)).toEqual(["픽업/확천", "픽업/확천"]);
  });
  it("무기: 운명 포인트는 그 기원에서만 — 기원이 바뀌면 고른 무기 확정이 풀린다", () => {
    const W = "genshin-weapon";
    let r = emptyRecords();
    r.games.genshin.currentBanner[W] = "W1";
    r.games.genshin.chosen = { [W]: { banner: "W1", name: "가" } };
    r = recordSession(r, "genshin", W, 1, new Map([[0, { name: "나", featured: true }]]), t(0)); // 고르지 않은 픽업 무기
    expect(groupStatus(r.games.genshin, "genshin", W).guaranteed).toBe(true);
    r.games.genshin.currentBanner[W] = "W2";
    r.games.genshin.chosen = { [W]: { banner: "W2", name: "다" } };
    expect(groupStatus(r.games.genshin, "genshin", W).guaranteed).toBe(false);
    // 고르지 않았으면 "픽뚫 다음은 픽업 무기 중 하나" 확정만 이어진다
    delete r.games.genshin.chosen;
    expect(groupStatus(r.games.genshin, "genshin", W).guaranteed).toBe(false);
    r = recordSession(r, "genshin", W, 1, new Map([[0, { name: "상시 무기", featured: false }]]), t(1));
    expect(groupStatus(r.games.genshin, "genshin", W).guaranteed).toBe(true);
  });
});

describe("명일방주 헤드헌팅 규칙", () => {
  const S = "arknights-standard";
  const setup = (banner: string, group = S) => {
    const r = emptyRecords();
    r.games.arknights.currentBanner[group] = banner;
    return r;
  };
  const st = (r: ReturnType<typeof emptyRecords>, group = S) => groupStatus(r.games.arknights, "arknights", group);
  it("단일 픽업(SINGLE): 150회가 지나면 다음 6성은 픽업 — 픽업을 얻으면 사라진다", async () => {
    const { hitLabel } = await import("./ledger");
    let r = setup("arknights:official:SINGLE_KR_1");
    r = recordSession(r, "arknights", S, 60, new Map([[59, { name: "가", featured: false }]]), t(0));
    expect(st(r).counters).toMatchObject([{ label: "다음 6성 픽업 확정", remaining: 90, done: false }]);
    r = recordSession(r, "arknights", S, 95, new Map([[94, { name: "픽업", featured: true }]]), t(1)); // 155번째
    expect(st(r).counters[0]).toMatchObject({ done: true });
    expect(topHistory(r.games.arknights, S).map(hitLabel)).toEqual(["픽뚫/반천", "픽업/확천"]);
  });
  it("단일 픽업: 150회 전에 나온 픽업은 확천이 아니다", async () => {
    const { hitLabel } = await import("./ledger");
    let r = setup("arknights:official:SINGLE_KR_1");
    r = recordSession(r, "arknights", S, 30, new Map([[29, { name: "픽업", featured: true }]]), t(0));
    expect(topHistory(r.games.arknights, S).map(hitLabel)).toEqual(["픽업"]);
  });
  it("더블 픽업(DOUBLE): 150회 뒤 둘 중 하나, 300회 뒤 나머지. 예전 풀(NORM)에는 카운터가 없다", () => {
    let r = setup("arknights:official:DOUBLE_KR_1");
    r = recordSession(r, "arknights", S, 40, new Map([[39, { name: "픽업1", featured: true }]]), t(0));
    expect(st(r).counters).toMatchObject([
      { label: "다음 6성 픽업(둘 중 하나)", done: true },
      { label: "다음 6성 남은 픽업", remaining: 260, done: false },
    ]);
    expect(st(setup("arknights:official:NORM_KR_1")).counters).toEqual([]);
  });
  it("한정: 300회에 교환과 별개로 한정 6성 증정", () => {
    const L = "arknights-limited";
    let r = setup("arknights:official:LIMITED_KR_1", L);
    r = recordSession(r, "arknights", L, 100, new Map(), t(0));
    expect(st(r, L).counters).toMatchObject([
      { label: "교환(데이터 계약)", remaining: 200 },
      { label: "한정 6성 증정", remaining: 200 },
    ]);
  });
  it("콜라보(새 규칙): 120회마다 픽업 확정, 픽업을 얻으면 처음부터 다시 센다", async () => {
    const { hitLabel } = await import("./ledger");
    const C = "arknights-collab";
    let r = setup("arknights:official:LINKAGE_KR_1", C);
    r = recordSession(r, "arknights", C, 30, new Map([[29, { name: "픽업", featured: true }]]), t(0));
    expect(st(r, C).counters[0]).toMatchObject({ label: "픽업 확정", remaining: 120, done: false });
    r = recordSession(r, "arknights", C, 50, new Map(), t(1));
    expect(st(r, C).counters[0]).toMatchObject({ remaining: 70 });
    r = recordSession(r, "arknights", C, 70, new Map([[69, { name: "픽업", featured: true }]]), t(2)); // 다시 센 120번째
    expect(topHistory(r.games.arknights, C).map(hitLabel)).toEqual(["픽업", "픽업/확천"]);
    expect(st(r, C).counters[0]).toMatchObject({ remaining: 120 });
  });
});

describe("최고 등급 기록 고치기·지우기 (사용자 2026-11-27)", () => {
  const G = "endfield-chartered";
  const build = async () => {
    const { recordTopAt } = await import("./ledger");
    let r = emptyRecords();
    r.games.endfield.currentBanner[G] = "B";
    for (const [n, name] of [[16, "가"], [58, "나"], [92, "다"], [120, "라"]] as const) r = recordTopAt(r, "endfield", G, n, { name, featured: false }, t(n)).records;
    return r;
  };
  const ats = (r: ReturnType<typeof emptyRecords>) => topHistory(r.games.endfield, G).map((h) => [h.at, h.pull.name]);
  const idOf = (r: ReturnType<typeof emptyRecords>, name: string) => r.games.endfield.pulls.find((p) => p.name === name)!.id;

  it("이름·픽업만 고치면 번째는 그대로", async () => {
    const { editTop } = await import("./ledger");
    const r = await build();
    const out = editTop(r, "endfield", idOf(r, "나"), { name: "나2", featured: true });
    expect(out.mode).toBe("ok");
    expect(ats(out.records)).toEqual([[16, "가"], [58, "나2"], [92, "다"], [120, "라"]]);
    expect(out.records.games.endfield.pulls.find((p) => p.name === "나2")!.featured).toBe(true);
  });
  it("가운데 기록의 번째를 고쳐도 뒤 기록의 번째와 총 횟수는 그대로", async () => {
    const { editTop } = await import("./ledger");
    const r = await build();
    const out = editTop(r, "endfield", idOf(r, "다"), { name: "다", featured: false, n: 82 });
    expect(out.mode).toBe("ok");
    expect(ats(out.records)).toEqual([[16, "가"], [58, "나"], [82, "다"], [120, "라"]]);
    expect(out.records.games.endfield.pulls).toHaveLength(120);
  });
  it("마지막 기록의 번째를 줄이거나 늘리면 총 횟수도 따라간다", async () => {
    const { editTop } = await import("./ledger");
    const r = await build();
    const down = editTop(r, "endfield", idOf(r, "라"), { name: "라", featured: false, n: 110 });
    expect(ats(down.records).at(-1)).toEqual([110, "라"]);
    expect(down.records.games.endfield.pulls).toHaveLength(110);
    expect(groupStatus(down.records.games.endfield, "endfield", G).pity).toBe(0);
    const up = editTop(r, "endfield", idOf(r, "라"), { name: "라", featured: false, n: 125 });
    expect(up.records.games.endfield.pulls).toHaveLength(125);
  });
  it("다른 기록이 있는 자리로는 옮기지 않는다", async () => {
    const { editTop } = await import("./ledger");
    const r = await build();
    expect(editTop(r, "endfield", idOf(r, "다"), { name: "다", featured: false, n: 58 }).mode).toBe("taken");
  });
  it("가운데 기록을 지우면 뒤 기록의 번째는 그대로, 마지막을 지우면 함께 넣은 뽑기까지", async () => {
    const { removeTop } = await import("./ledger");
    const r = await build();
    const mid = removeTop(r, "endfield", idOf(r, "나"));
    expect(ats(mid)).toEqual([[16, "가"], [92, "다"], [120, "라"]]);
    expect(mid.games.endfield.pulls).toHaveLength(120);
    const last = removeTop(r, "endfield", idOf(r, "라"));
    expect(ats(last)).toEqual([[16, "가"], [58, "나"], [92, "다"]]);
    expect(last.games.endfield.pulls).toHaveLength(92);
  });
  it("고친 것은 한 번에 되돌린다", async () => {
    const { editTop } = await import("./ledger");
    const r = await build();
    const out = editTop(r, "endfield", idOf(r, "라"), { name: "라", featured: false, n: 110 }).records;
    expect(out.undo).toHaveLength(r.undo.length + 1);
    const back = undo(out).records;
    expect(ats(back)).toEqual(ats(r));
    expect(back.games.endfield.pulls).toHaveLength(120);
  });
});
