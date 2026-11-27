// 떼어 낸 부분 시험 (정리 2026-11-27): 공용 상태, 홈 기록 조작, 계정 동기화·친구 공유.
// 휴대폰·PC 기능(api)과 서버(sync)는 가짜로 바꿔 끼운다.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ inTauri: false, android: null, androidMode: null, readStore: vi.fn(), writeStore: vi.fn() }));
const fake = vi.hoisted(() => ({
  shares: [] as unknown[],
  removed: [] as string[],
  remote: { games: {}, settings: null } as { games: Record<string, unknown>; settings: unknown },
  pushedGames: [] as string[],
}));
vi.mock("../sync", () => ({
  syncConfigured: true,
  watchAccount: () => () => {},
  signIn: vi.fn(),
  signOutAccount: vi.fn(),
  pullAll: vi.fn(async () => fake.remote),
  pushGame: vi.fn(async (_uid: string, id: string) => { fake.pushedGames.push(id); }),
  pushSettings: vi.fn(async () => {}),
  pushShare: vi.fn(async (_uid: string, summary: unknown) => { fake.shares.push(summary); }),
  removeShare: vi.fn(async (uid: string) => { fake.removed.push(uid); }),
  pullShares: vi.fn(async () => []),
  deleteAccount: vi.fn(async () => "deleted"),
}));
// 시험 환경에는 브라우저 저장소가 없다
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

const { app } = await import("../store.svelte");
const act = await import("./records");
const { AccountFlow } = await import("./account.svelte");
const { emptyRecords, groupStatus, topHistory } = await import("../ledger");
const { defaultSettings } = await import("../settings");

// 기록마다 1분씩 시간이 흐르게 한다(같은 순간에 넣은 기록은 순서가 모호하다 — 사람이 입력할 때는 생기지 않음)
let clock = Date.UTC(2026, 10, 27, 3, 0);
vi.useFakeTimers({ toFake: ["Date"] });
const tick = () => vi.setSystemTime((clock += 60_000));
const realSaveTopAt = act.saveTopAt;
const saveTopAt = (n: number, name: string) => { tick(); realSaveTopAt(n, name); };

beforeEach(() => {
  app.records = emptyRecords();
  app.settings = defaultSettings();
  app.game = "endfield";
  app.loaded = true;
  app.toast = null;
  mem.clear();
  fake.shares = []; fake.removed = []; fake.pushedGames = []; fake.remote = { games: {}, settings: null };
});

describe("공용 상태 (store)", () => {
  it("보고 있던 게임을 내 게임에서 빼면 남은 첫 게임으로 바뀐다", () => {
    app.setSettings({ ...app.settings, myGames: ["genshin", "limbus"] });
    expect(app.game).toBe("genshin");
    expect(app.settings.lastGame).toBe("genshin");
  });
  it("되돌릴 것이 없으면 알림만", () => {
    app.undo();
    expect(app.toast).toBe("되돌릴 기록이 없습니다");
  });
});

describe("홈 기록 조작 (flows/records)", () => {
  it("무기고 37번째 → 40번째로 기록하고 그렇게 알린다", () => {
    app.settings = { ...app.settings, activeGroup: { ...app.settings.activeGroup, endfield: "endfield-arsenal" } };
    app.records.games.endfield.currentBanner["endfield-arsenal"] = "W";
    saveTopAt(37, "무기");
    expect(app.records.games.endfield.pulls).toHaveLength(40);
    expect(app.toast).toBe("37 → 40번째(10회 묶음 단위)로 무기 기록");
  });
  it("다른 기록이 있는 번째로 옮기면 막고 알린다, 되돌리면 원래대로", () => {
    app.records.games.endfield.currentBanner["endfield-chartered"] = "B";
    saveTopAt(16, "가");
    saveTopAt(58, "나");
    const id = app.records.games.endfield.pulls.find((p) => p.name === "나")!.id;
    act.editTopRecord(id, { name: "나", featured: false, n: 16 });
    expect(app.toast).toBe("그 번째에는 이미 다른 6성 기록이 있습니다");
    tick();
    act.editTopRecord(id, { name: "나", featured: false, n: 40 });
    expect(topHistory(app.records.games.endfield, "endfield-chartered").map((h) => h.at)).toEqual([16, 40]);
    app.undo();
    expect(topHistory(app.records.games.endfield, "endfield-chartered").map((h) => h.at)).toEqual([16, 58]);
  });
  it("재화 직접 입력은 0 이상의 정수로", () => {
    act.editCurrency("oroberyl", "-5");
    expect(app.records.games.endfield.currency.oroberyl).toBe(0);
    act.editCurrency("oroberyl", "1234.9");
    expect(app.records.games.endfield.currency.oroberyl).toBe(1234);
  });
  it("횟수만 맞추기는 지금보다 큰 숫자만", () => {
    app.records.games.endfield.currentBanner["endfield-chartered"] = "B";
    act.pullsTo(30);
    expect(groupStatus(app.records.games.endfield, "endfield", "endfield-chartered").bannerPulls).toBe(30);
    act.pullsTo(10);
    expect(app.toast).toBe("지금 기록(30번째)보다 큰 숫자를 넣어 주세요");
  });
});

describe("계정 동기화·친구 공유 (flows/account)", () => {
  function make() {
    const flow = new AccountFlow();
    const stop = () => {};
    flow.account = { uid: "u1", email: null, name: null } as never;
    return { flow, stop };
  }

  it("참여하면 닉네임으로 공유를 켜고 요약을 올린다(재화는 안 올라감)", async () => {
    const { flow, stop } = make();
    app.records.games.endfield.currency.oroberyl = 999;
    app.records.games.endfield.currentBanner["endfield-chartered"] = "B";
    saveTopAt(30, "가");
    await flow.join("  닉네임  ".trim());
    expect(app.settings.share).toMatchObject({ on: true, nickname: "닉네임" });
    expect(fake.shares).toHaveLength(1);
    expect(JSON.stringify(fake.shares[0])).not.toContain("999");
    stop();
  });
  it("공유를 끄면 올린 요약을 지운다", async () => {
    const { flow, stop } = make();
    app.settings = { ...app.settings, share: { on: true, nickname: "가" } };
    await flow.toggleShare(false);
    expect(app.settings.share?.on).toBe(false);
    expect(fake.removed).toEqual(["u1"]);
    stop();
  });
  it("처음 연결: 계정 쪽 기록과 합치고(둘 다 남김) 이 기기 기록을 올린다", async () => {
    const { flow, stop } = make();
    app.records.games.endfield.currentBanner["endfield-chartered"] = "B";
    saveTopAt(20, "이 기기");
    const remote = emptyRecords().games.genshin;
    remote.currency = { primogem: 160 };
    remote.updatedAt = new Date().toISOString();
    fake.remote = { games: { genshin: remote }, settings: null };
    await flow.syncNow();
    expect(flow.syncState).toBe("ok");
    expect(app.records.games.genshin.currency.primogem).toBe(160);
    expect(app.records.games.endfield.pulls).toHaveLength(20);
    expect(fake.pushedGames).toContain("endfield");
    stop();
  });
  it("바뀐 게임만 올린다 (한 번 올린 것은 다시 안 올림)", async () => {
    const { flow } = make();
    app.records.games.endfield.currentBanner["endfield-chartered"] = "B";
    saveTopAt(10, "가");
    await flow.pushNow();
    expect(fake.pushedGames).toEqual(["endfield"]);
    await flow.pushNow();
    expect(fake.pushedGames).toEqual(["endfield"]);
    expect(flow.syncState).toBe("ok");
  });
});

describe("림버스: 추출 화면의 이상 N/200으로 기록 (flows/screen, 실기 글자)", async () => {
  const { readFileSync } = await import("node:fs");
  const { parseFrameText } = await import("../recognize");
  const { ScreenFlow } = await import("./screen.svelte");
  const text = readFileSync(new URL("../fixtures/limbus-main-phone2.txt", import.meta.url), "utf8");
  const frameWith = (n: number) => JSON.stringify(parseFrameText(text.replace("10/200", `${n}/200`)));
  it("처음엔 기준만(앱 누적을 10으로 맞춤), 이상이 40이 되면 30회 기록, 재화는 안 깎음", () => {
    app.game = "limbus";
    app.pack = { schemaVersion: 1, games: { genshin: [], arknights: [], endfield: [], limbus: [{
      id: "lb-pick", group: "limbus-extraction", name: "pick", start: "2026-11-26T03:00:00.000Z", end: "2026-12-10T01:00:00.000Z", version: null,
      featured: [{ id: "a", ko: "오트쿠튀르::르루주 B2F 타래둥지 그레고르" }, { id: "b", ko: "오트쿠튀르::르누아르 B3F 건조장 이상" }], featuredRare: [],
    }] } } as never;
    app.records.games.limbus.currentBanner["limbus-extraction"] = "lb-pick";
    app.records.games.limbus.currency = { ticket: 5 };
    const flow = new ScreenFlow(() => {});
    flow.onScreenText(frameWith(10));
    flow.onScreenText(frameWith(10));
    expect(groupStatus(app.records.games.limbus, "limbus", "limbus-extraction").bannerPulls).toBe(10);
    expect(app.records.games.limbus.pulls).toHaveLength(0);
    flow.onScreenText(frameWith(40));
    flow.onScreenText(frameWith(40));
    expect(app.records.games.limbus.pulls).toHaveLength(30);
    expect(groupStatus(app.records.games.limbus, "limbus", "limbus-extraction").bannerPulls).toBe(40);
    expect(app.records.games.limbus.currency.ticket).toBe(5);
    expect(app.toast).toContain("30회 자동 기록 (이상 10→40)");
  });
});

describe("림버스 이상: 교환과 20회 넘는 경우 (flows/screen)", async () => {
  const { readFileSync } = await import("node:fs");
  const { parseFrameText } = await import("../recognize");
  const { ScreenFlow } = await import("./screen.svelte");
  const text = readFileSync(new URL("../fixtures/limbus-main-phone2.txt", import.meta.url), "utf8");
  const frameWith = (n: number) => JSON.stringify(parseFrameText(text.replace("10/200", `${n}/200`)));
  const setup = () => {
    app.game = "limbus";
    app.pack = { schemaVersion: 1, games: { genshin: [], arknights: [], endfield: [], limbus: [{
      id: "lb-pick", group: "limbus-extraction", name: "pick", start: "2026-11-26T03:00:00.000Z", end: "2026-12-10T01:00:00.000Z", version: null,
      featured: [{ id: "a", ko: "오트쿠튀르::르루주 B2F 타래둥지 그레고르" }], featuredRare: [],
    }] } } as never;
    app.records.games.limbus.currentBanner["limbus-extraction"] = "lb-pick";
    return new ScreenFlow(() => {});
  };
  it("190 → (10뽑 후 교환) → 0: 10회 + 교환 1건", () => {
    const flow = setup();
    for (const n of [190, 190, 0, 0]) flow.onScreenText(frameWith(n));
    expect(app.records.games.limbus.pulls).toHaveLength(10);
    expect(app.records.games.limbus.exchanges ?? []).toHaveLength(1);
  });
  it("40 → \"4\"(잘못 읽힘): 교환 + 164회로 보이지만 기록하지 않고 알림", () => {
    const flow = setup();
    for (const n of [40, 40, 4, 4]) flow.onScreenText(frameWith(n));
    expect(app.records.games.limbus.pulls).toHaveLength(0);
    expect(app.records.games.limbus.exchanges ?? []).toHaveLength(0);
    expect(app.toast).toContain("40→4로 줄었습니다");
  });
  it("20회 넘게 몰아 뽑으면 기록하되 이력에 안 남는다고 알리고 확인할 것에 표시", () => {
    const flow = setup();
    for (const n of [10, 10, 60, 60]) flow.onScreenText(frameWith(n));
    expect(app.records.games.limbus.pulls).toHaveLength(50);
    expect(app.toast).toContain("앞의 30회는 추출 이력에 안 남습니다");
    expect(flow.autoLog.at(-1)?.uncertain).toBe(true);
  });
});
