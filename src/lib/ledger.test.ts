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
  it("명일방주 일반은 배너가 바뀌면 새로 (이월 안 되는 것으로 계산)", () => {
    let r = emptyRecords();
    r.games.arknights.currentBanner["arknights-standard"] = "A";
    r = recordSession(r, "arknights", "arknights-standard", 20, new Map(), t(0));
    r.games.arknights.currentBanner["arknights-standard"] = "B";
    expect(groupStatus(r.games.arknights, "arknights", "arknights-standard").pity).toBe(0);
  });
});

describe("직접 입력: n뽑에 최고 등급", () => {
  const G = "endfield-chartered";
  const st = (r: ReturnType<typeof emptyRecords>) => groupStatus(r.games.endfield, "endfield", G);
  it("32스택에서 10연을 기록했고 7번째(39뽑)에 나왔다 → 그 자리 표시, 남은 스택 3", async () => {
    const { recordTopAt } = await import("./ledger");
    let r = syncPityFromScreen(emptyRecords(), "endfield", G, 48, null); // 32스택
    r = recordSession(r, "endfield", G, 10, new Map(), t(0));
    const out = recordTopAt(r, "endfield", G, 39, { name: "케르", featured: true }, t(1));
    expect(out.mode).toBe("marked");
    expect(st(out.records).pity).toBe(3);
    expect(out.records.games.endfield.pulls.find((p) => p.top)).toMatchObject({ name: "케르", featured: true, indexInSession: 6 });
  });
  it("아직 기록 안 된 뽑기면 모자란 만큼 더한다", async () => {
    const { recordTopAt } = await import("./ledger");
    const r = syncPityFromScreen(emptyRecords(), "endfield", G, 48, null); // 32스택, 기록 0
    const out = recordTopAt(r, "endfield", G, 39, { name: "케르", featured: false }, t(1));
    expect(out.mode).toBe("added");
    expect(out.records.games.endfield.pulls).toHaveLength(7);
    expect(st(out.records).pity).toBe(0);
  });
  it("시작 상태 구간이면 스택만 줄인다", async () => {
    const { recordTopAt } = await import("./ledger");
    const r = syncPityFromScreen(emptyRecords(), "endfield", G, 48, null);
    const out = recordTopAt(r, "endfield", G, 20, { name: null, featured: null }, t(1));
    expect(out.mode).toBe("baseline");
    expect(st(out.records).pity).toBe(12);
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

describe("직접 입력 안전장치", () => {
  it("기준값이 음수여도 n뽑 입력이 뽑기를 부풀리지 않고, 천장보다 큰 숫자는 받지 않는다", async () => {
    const { recordTopAt } = await import("./ledger");
    const G = "endfield-chartered";
    const r = emptyRecords();
    r.games.endfield.baseline[G] = { ...emptyBaseline(), pity: -74 };
    const out = recordTopAt(r, "endfield", G, 39, { name: "가", featured: null }, t(0));
    expect(out.records.games.endfield.pulls).toHaveLength(39);
    expect(recordTopAt(r, "endfield", G, 200, { name: "가", featured: null }, t(0)).records).toBe(r);
  });
});
