// 화면 읽기 → 기록 (정리 2026-11-27: App.svelte에서 떼어 냄).
// - 재화 차이로 뽑기 감지(detect.ts) → 바로 기록, 이상하면 "확인할 것"으로
// - PC 새 화면 인식(engine.ts) 결과 반영
// - 공식 기록 화면(원신·엔드필드·명방·림버스) 읽어 두었다가 화면을 떠나면 반영
// - 원신 기원 기록 불러오기(PC)
// - 자동 기록 목록(취소용)
import * as api from "../api";
import { app } from "../store.svelte";
import { itemNames } from "../images.svelte";
import { GAMES, GAME_IDS, findGroup } from "../games";
import { groupBanners, itemName, matchFeatured } from "../banners";
import { inferTopFromScreen, recordDetected, recordResult, setCurrency, syncBannerPulls, syncPityFromScreen } from "../ledger";
import { emptyEngineState, engineStep, type EngineAction, type EngineStatus, type RegionFrame } from "../engine";
import { PROFILES, resultCountingReady } from "../screen-profile";
import { newestIds, wishFeatured, wishRows } from "../genshin-wish";
import { looksLikeGacha, normalizeFrame, readScreen, steadyCounts, type ScreenFrame, type ScreenReading, type SteadyCounts } from "../recognize";
import { emptyDetectState, step as detectStep, type Detection, type ItemTable } from "../detect";
import { LimbusPulls } from "./limbus.svelte";
import { readLocal, writeLocal } from "./local";
import { applyLimbusHistory, joinSequence, mergeSequence, parseLimbusHistory, type LimbusRow } from "../limbus-history";
import { importHistory, mergePages, missingPages, parseArknightsHistory, parseEndfieldHistory, parseGenshinHistory, type HistoryRow } from "../history";
import type { GameId, Records } from "../types";
import genshinItemsFile from "../../../data/genshin-items.json";
import endfieldSixFile from "../../../data/names/endfield-6star.json";
import arknightsSixFile from "../../../data/names/arknights-6star.json";
import arknightsPoolsFile from "../../../data/names/arknights-pools.json";

export const genshinItems = ((genshinItemsFile as { items?: ItemTable }).items ?? {}) as ItemTable;
/** 엔드필드·명방 6성 이름 (공식 기록에 등급이 없을 때 6성인지 알아내는 데 쓴다) */
export const sixStars: Partial<Record<GameId, Set<string>>> = {
  endfield: new Set((endfieldSixFile as { names?: string[] }).names ?? []),
  arknights: new Set((arknightsSixFile as { names?: string[] }).names ?? []),
};
const arknightsPools = arknightsPoolsFile.pools as Record<string, string | null>;

const DETECT_KEY = "tg-detections";
const DETECT_STATE_KEY = "tg-detect-state";
const HISTORY_KEY = "tg-history";
const LIMBUS_KEY = "tg-history-limbus";
const AUTO_KEY = "tg-auto-log";
const WISH_LAST_KEY = "tg-genshin-wish-last";
export const HISTORY_GAMES: GameId[] = ["genshin", "endfield", "arknights"];

export interface AutoEntry { id: string; game: GameId; label: string; pullIds: string[]; uncertain: boolean; time: number }
type HistoryStore = Partial<Record<GameId, Record<string, HistoryRow>>>;

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const topRarityOf = (g: GameId) => (g === "genshin" ? 5 : 6);

/** 명일방주 기록의 배너 이름 → 종류 처음 값: 게임 데이터 표에 있으면 그 종류, 여러 종류라 모르면 빈칸(직접 고름), 표에 없으면 한정 */
export function arknightsDefault(b: string): string {
  const key = b.replace(/\s+/g, " ").trim();
  if (key in arknightsPools) return arknightsPools[key] ?? "";
  return /커널|상시|기초|초심자/.test(b) ? "" : "arknights-limited";
}

export class ScreenFlow {
  // ── 화면 읽기 상태 (설정 아래 "화면 읽기"에 보인다) ──
  screenOn = $state(!!api.android?.screenReading?.());
  screenMessage = $state("");
  screenFrame = $state.raw<ScreenFrame | null>(null);
  screenResult = $state.raw<ScreenReading | null>(null);
  engineStatus = $state<EngineStatus>({ kind: "idle", message: "", screen: null, at: 0 });
  // ── 확인할 것 ──
  detections = $state.raw<Detection[]>(readLocal<Detection[]>(DETECT_KEY, []));
  historyStore = $state.raw<HistoryStore>(ScreenFlow.loadHistory());
  limbusRows = $state.raw<LimbusRow[]>(readLocal<LimbusRow[]>(LIMBUS_KEY, []));
  autoLog = $state.raw<AutoEntry[]>(readLocal<AutoEntry[]>(AUTO_KEY, []));
  // ── 원신 기원 기록 불러오기 ──
  wishBusy = $state(false);
  wishMsg = $state("");

  /** "확인할 것" 개수 (홈 알림 줄·탭 배지) */
  pending = $derived(
    this.detections.length + (app.lastApply ? 1 : 0) + this.autoLog.filter((e) => e.uncertain).length + (this.limbusRows.length ? 1 : 0)
    + HISTORY_GAMES.filter((g) => Object.keys(this.historyStore[g] ?? {}).length).length
    + GAME_IDS.reduce((n, id) => n + app.records.games[id].pulls.filter((p) => p.status === "pending").length, 0),
  );
  engineFailing = $derived(this.engineStatus.kind === "fail");

  private detectState = ScreenFlow.loadDetectState();
  private engineState = emptyEngineState();
  private steady: { game: GameId; counts: SteadyCounts } | null = null;
  private lastHistoryAt = 0;
  private askedManual: GameId | null = null;
  /** 림버스 뽑기 세기(확인 창 + 이상 N/200) */
  private limbus = new LimbusPulls((e) => this.addAuto(e));
  private warnedGapAt = 0;
  /** 림버스 이상 N/200 (배너별 마지막 값은 저장해 두고 이어서 센다) */

  /** 원신 5성이 나왔을 때 "기원 기록 불러올까요?" 묻기 (확인 창은 화면 쪽에 있다) */
  constructor(private askGenshinReload: () => void) {}

  private static loadDetectState() {
    const base = emptyDetectState();
    const saved = readLocal<{ stable?: typeof base.stable; stableAt?: typeof base.stableAt } | null>(DETECT_STATE_KEY, null);
    // 마지막으로 읽은 재화는 이어서 쓴다(가챠 화면을 열자마자 뽑아도 셀 수 있게)
    return saved?.stable ? { ...base, stable: saved.stable, stableAt: saved.stableAt ?? {} } : base;
  }
  private static loadHistory(): HistoryStore {
    const all = readLocal<HistoryStore>(HISTORY_KEY, {});
    const oldEndfield = readLocal<Record<string, HistoryRow> | null>("tg-history-endfield", null); // 0.6.0 저장분
    if (oldEndfield && !all.endfield) all.endfield = oldEndfield;
    return all;
  }

  // ───────── 화면 글자 받기 (안드로이드 오버레이·PC) ─────────

  /** 화면에서 읽은 글자 한 장 */
  onScreenText = (json: string) => {
    try {
      const raw = JSON.parse(json) as ScreenFrame;
      const f = normalizeFrame(raw); // 자주 틀리게 읽히는 낱말을 바로잡은 것 (복사용은 원본 그대로 둔다)
      this.screenOn = true;
      const r = readScreen(f);
      // "읽은 글자 복사"용으로는 게임 가챠 화면으로 보이는 것만 남긴다(다른 앱 글자를 붙잡아 두지 않게).
      // PC는 원인을 볼 수 있게 마지막으로 읽은 화면을 항상 남긴다.
      if (r || looksLikeGacha(f) || api.inTauri) this.screenFrame = raw;
      // 림버스 추출 확인 창: 뜰 때마다 바로 센다(결과 화면의 "재추출"도) — flows/limbus.svelte.ts
      this.limbus.onLines(f.lines);
      this.onFrame(f, r);
      if (!r) this.readHistory(f);
      if (r) this.onReading(f, r);
    } catch { /* 깨진 데이터는 버린다 */ }
  };

  /** 화면 읽기 켜짐·꺼짐·거부 */
  onScreenState = (json: string) => {
    try {
      const st = JSON.parse(json) as { state: string; message: string };
      this.screenOn = st.state === "started";
      this.screenMessage = st.state === "denied" ? "화면 녹화를 허용하지 않아 시작하지 못했습니다."
        : st.state === "error" ? `시작하지 못했습니다: ${st.message}` : "";
    } catch { /* 무시 */ }
  };

  /** 가챠 메인 화면을 읽었을 때: 천장 숫자 맞추기, 보고 있는 게임 바꾸기 */
  private onReading(f: ScreenFrame, r: ScreenReading) {
    // 이번에 일부를 못 읽었으면(가려짐 등) 같은 게임에서 직전에 읽은 값을 남겨 둔다
    if (this.screenResult?.game === r.game) r.currency = { ...this.screenResult.currency, ...r.currency };
    // 천장까지 남은 횟수는 두 번 연속 같게 읽힌 값만 보여 준다 ("53"이 "3"으로 읽혀 왔다 갔다 하던 문제)
    const counts = steadyCounts(this.steady?.game === r.game ? this.steady.counts : null, r);
    this.steady = { game: r.game, counts };
    r.toTop = counts.shown.toTop;
    r.toFeatured = counts.shown.toFeatured;
    // 엔드필드 한정 배너 화면에 적힌 남은 횟수로 앱의 천장 수치를 맞춘다(사용자 요청 2026-11-25). 두 번 연속 같게 읽힌 값만.
    // 재화 변화가 아직 확인 중이면(방금 뽑은 것이 기록되기 전) 기다린다. 먼저 맞추면 직전 묶음에 잘못 붙는다.
    const stableNow = this.detectState.stable.endfield ?? {};
    const currencySettled = Object.entries(r.currency).every(([k, v]) => stableNow[k] === v);
    // 한정·재구축 화면이 같은 문구를 쓰므로, 화면의 픽업 이름이 어느 배너 것인지 확인된 때만 그 칸에 맞춘다
    const efGroup = r.game === "endfield" ? this.endfieldGroupOnScreen(f) : null;
    if (efGroup && counts.settled && r.toFeatured !== null && currencySettled) {
      const records = app.records;
      const marked = inferTopFromScreen(records, "endfield", efGroup, r.toTop, r.toFeatured);
      if (marked !== records) app.notify("6성 획득을 화면 천장 숫자로 기록했습니다 (이름은 헤드헌팅 기록 화면에서 채워집니다)");
      const synced = syncPityFromScreen(marked, "endfield", efGroup, r.toTop, r.toFeatured);
      if (synced !== records) app.update(synced);
    }
    if (r.game === "limbus") this.limbus.onReading(r);
    this.screenResult = r;
    // 읽은 화면이 다른 게임이면 그 게임으로 바꾼다 (기록은 건드리지 않는다)
    if (r.game !== app.game) app.setGame(r.game);
  }

  /**
   * 엔드필드 헤드헌팅 화면이 한정인지 재구축인지: 화면 글자에 그 칸의 지금 배너 픽업 이름이 보이는 쪽.
   * 둘 다 보이거나 둘 다 안 보이면 null(모름 — 추측하지 않는다).
   */
  private endfieldGroupOnScreen(f: ScreenFrame): string | null {
    const text = f.lines.map((l) => l.t.replace(/\s+/g, "")).join("\n");
    const hit = ["endfield-chartered", "endfield-refactor"].filter((gid) => {
      const b = app.currentBanner("endfield", gid);
      return !!b && b.featured.some((it) => { const n = itemName(it).replace(/\s+/g, ""); return n.length >= 1 && text.includes(n); });
    });
    return hit.length === 1 ? hit[0] : null;
  }

  /** 재화 변화로 뽑기 감지 → 바로 기록 */
  private onFrame(f: ScreenFrame, r: ScreenReading | null) {
    const out = detectStep(this.detectState, f, r, {
      spendOf: (g) => findGroup(g, app.activeGroup(g)).spend,
      genshinItems,
      newId: () => `det-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });
    // 두 번 연속 같게 읽힌 재화는 앱에 바로 반영한다(사용자 요청 2026-11-25)
    for (const g of GAME_IDS) {
      const now = out.state.stable[g];
      if (!now || JSON.stringify(now) === JSON.stringify(this.detectState.stable[g])) continue;
      // 잘라 읽기가 방금(5초 안) 실제로 읽어 낸 재화만 빼고 반영한다. 잘라 읽기가 못 읽으면 예전처럼 이 값을 쓴다
      // (PC 실기 2026-11-27: 화면만 알아보고 칸을 못 읽어서 모든 게임 재화가 안 바뀌던 문제)
      const fresh = this.regionCurrencyAt[g] ?? {};
      const rest = Object.fromEntries(Object.entries(now).filter(([k]) => Date.now() - (fresh[k] ?? 0) >= 5000));
      if (Object.keys(rest).length) this.setCurrencyIfChanged(g, rest);
    }
    if (JSON.stringify(out.state.stable) !== JSON.stringify(this.detectState.stable)) {
      writeLocal(DETECT_STATE_KEY, { stable: out.state.stable, stableAt: out.state.stableAt });
    }
    this.detectState = out.state;
    // 결과 화면으로 횟수를 세는 게임은 재화 차이로 뽑기를 기록하지 않는다(두 번 세지 않게, DESIGN.md §4.8)
    if (!out.detection || resultCountingReady(out.detection.game)) return;
    // 림버스는 "이상 N/200"으로 센다(countLimbus) — 광기 감소로 또 세지 않는다
    if (out.detection.game === "limbus") return;
    // 감지되면 바로 기록한다(사용자 요청 2026-11-25). 확실하지 않은 것은 "확인"에 표시해 취소할 수 있게 한다.
    const d = out.detection;
    // 엔드필드는 화면의 픽업 이름으로 한정/재구축을 알 수 있으면 그 칸에, 아니면 골라 둔 칸에 기록한다
    const gid = (d.game === "endfield" ? this.endfieldGroupOnScreen(f) : null) ?? app.activeGroup(d.game);
    // 한 번에 20회를 넘거나, 확실하지 않은데 10회를 넘으면 잘못 읽은 것일 수 있다 → "확인할 것"에서 묻는다(2026-11-26)
    if (d.count > 20 || (d.uncertain && d.count > 10)) {
      this.saveDetections([...readLocal<Detection[]>(DETECT_KEY, []), d]);
      app.notify(`${GAMES[d.game].shortName} ${d.count}회로 읽혔습니다. 맞는지 "확인할 것"에서 골라 주세요`);
    } else this.saveDetection(d, gid, d.count, true);
  }

  private setCurrencyIfChanged(game: GameId, values: Record<string, number>) {
    const cur = app.records.games[game].currency;
    const diff = Object.fromEntries(Object.entries(values).filter(([k, v]) => cur[k] !== v));
    if (Object.keys(diff).length) app.update(setCurrency(app.records, game, diff));
  }

  // ───────── PC 새 화면 인식 (DESIGN.md §4.8): 정해진 위치만 잘라 읽은 결과 → 틀로 해석 → 검증 → 반영 ─────────

  /** 게임·재화별로 잘라 읽기(새 방식)가 마지막으로 값을 읽어 낸 때. 그 동안 그 재화는 화면 전체 글자로 읽은 값을 쓰지 않는다
   *  (같은 화면을 두 방식이 다르게 읽으면 값이 왔다 갔다 한다, PC 실기 2026-11-27: 명방 합성옥) */
  private regionCurrencyAt: Partial<Record<GameId, Record<string, number>>> = {};
  /** 마지막으로 잘라 읽은 화면과 칸 글자("읽은 글자 복사"에 함께 넣는다 — 못 읽을 때 원인을 보려고) */
  lastRegion = $state.raw<RegionFrame | null>(null);

  onRegions = (frame: RegionFrame) => {
    if (frame.screen) this.lastRegion = frame;
    const out = engineStep(this.engineState, frame, PROFILES);
    this.engineState = out.state;
    this.engineStatus = out.state.status;
    for (const a of out.actions) this.applyEngine(a);
  };

  private applyEngine(a: EngineAction) {
    const records = app.records;
    if (a.type === "currency") {
      const at = { ...(this.regionCurrencyAt[a.game] ?? {}) };
      for (const k of Object.keys(a.values)) at[k] = Date.now();
      this.regionCurrencyAt[a.game] = at;
      this.setCurrencyIfChanged(a.game, a.values);
    } else if (a.type === "pity") {
      // 검증을 통과한 천장 값은 바로 반영한다(규칙 7은 사용자가 뺐다, 2026-11-26)
      const marked = inferTopFromScreen(records, a.game, a.group, a.toTop, a.toFeatured);
      if (marked !== records) app.notify(`${GAMES[a.game].topLabel} 획득을 화면 천장 숫자로 기록했습니다`);
      const synced = syncPityFromScreen(marked, a.game, a.group, a.toTop, a.toFeatured);
      if (synced !== records) app.update(synced);
    } else if (a.type === "bannerPulls") {
      const synced = syncBannerPulls(records, a.game, a.group, a.value);
      if (synced !== records) app.update(synced);
    } else if (a.type === "result") {
      const gid = a.group ?? app.activeGroup(a.game);
      const next = recordResult(records, a.game, gid, a.count, a.tops, new Date());
      app.update(next);
      const label = `${GAMES[a.game].shortName} ${findGroup(a.game, gid).name} ${a.count}회`;
      this.addAuto({ id: `res-${Date.now()}`, game: a.game, label, pullIds: next.undo.at(-1)?.addedPullIds ?? [], uncertain: false, time: Date.now() });
      app.notify(`${label} 자동 기록 (결과 화면${a.tops.length ? `, ${GAMES[a.game].topLabel} ${a.tops.length}개` : ""})`);
      if (a.game === "genshin" && a.tops.length) this.askGenshinReload();
    } else if (a.type === "signal") {
      if (a.game === "genshin") this.askGenshinReload();
    }
  }

  // ───────── 감지한 뽑기 ─────────

  saveDetections = (list: Detection[]) => {
    this.detections = list;
    writeLocal(DETECT_KEY, list);
  };
  // 목록은 저장된 것을 다시 읽어서 고친다(휴대폰 앱 창과 게임 위 창이 같은 저장소를 쓴다)
  discardDetection = (id: string) => this.saveDetections(readLocal<Detection[]>(DETECT_KEY, []).filter((x) => x.id !== id));

  /** 감지한 뽑기를 기록한다. auto = 사용자가 고르지 않고 바로 기록한 것(자동 기록 목록에 남긴다) */
  saveDetection = (d: Detection, gid: string, count: number, auto = false) => {
    const top = topRarityOf(d.game);
    const banner = groupBanners(app.pack, d.game, gid).find((b) => b.id === app.records.games[d.game].currentBanner[gid]);
    // 3성은 기록하지 않는다(사용자 요청). 4성 이상만 이름·등급을 남긴다.
    const items = d.items.filter((i) => i.rarity >= 4).map((i) => ({
      name: i.name, rarity: i.rarity, top: i.rarity >= top, featured: i.rarity >= top ? matchFeatured(banner, i.name) : null,
    }));
    const next = recordDetected(app.records, d.game, gid, count, items, d.after, new Date(d.time));
    app.update(next);
    this.discardDetection(d.id);
    const label = `${GAMES[d.game].shortName} ${findGroup(d.game, gid).name} ${count}회`;
    if (auto) {
      this.addAuto({ id: d.id, game: d.game, label, pullIds: next.undo.at(-1)?.addedPullIds ?? [], uncertain: d.uncertain, time: d.time });
      app.notify(`${label} 자동 기록${d.uncertain ? " (확실하지 않음 — \"확인\"에서 취소 가능)" : ""}`);
    } else app.notify(`${label} 기록 완료`);
  };

  guessFeaturedFor = (g: GameId, gid: string, name: string): boolean | null => matchFeatured(app.currentBanner(g, gid), name);

  // ───────── 자동 기록 목록 (취소·확인용) ─────────

  saveAutoLog = (list: AutoEntry[]) => {
    this.autoLog = list.slice(-20);
    writeLocal(AUTO_KEY, this.autoLog);
  };
  private addAuto(e: AutoEntry) { this.saveAutoLog([...this.autoLog, e]); }
  /** 목록에서만 지운다(기록은 그대로) */
  confirmAuto = (e: AutoEntry) => this.saveAutoLog(this.autoLog.filter((x) => x.id !== e.id));
  /** 자동 기록 취소: 그때 넣은 뽑기를 지운다(재화는 화면에서 읽은 값 그대로 둔다) */
  cancelAuto = (e: AutoEntry) => {
    const next = structuredClone(app.records);
    const ids = new Set(e.pullIds);
    next.games[e.game].pulls = next.games[e.game].pulls.filter((p) => !ids.has(p.id));
    app.update(next);
    this.confirmAuto(e);
    app.notify(`${e.label} 취소`);
  };

  // ───────── 공식 기록 화면 (엔드필드 헤드헌팅 기록, 원신 기원 기록, 명일방주 요스타 가챠 기록, 림버스 추출 이력) ─────────

  historyRowsOf = (g: GameId) => Object.values(this.historyStore[g] ?? {});
  isTopRow = (g: GameId) => (r: HistoryRow) => (r.rarity != null ? r.rarity >= topRarityOf(g) : !!sixStars[g]?.has(r.name));
  manualPulls = (g: GameId) => app.records.games[g].pulls.filter((p) => p.source === "manual").length;

  saveHistory = (game: GameId, store: Record<string, HistoryRow>) => {
    this.historyStore = { ...this.historyStore, [game]: store };
    writeLocal(HISTORY_KEY, this.historyStore);
    try { localStorage.removeItem("tg-history-endfield"); } catch { /* 무시 */ }
  };

  private readHistory(f: ScreenFrame) {
    const page = parseEndfieldHistory(f) ?? parseGenshinHistory(f, (n) => genshinItems[n]?.rarity ?? null) ?? parseArknightsHistory(f);
    if (page?.rows.length) { this.saveHistory(page.game, mergePages(this.historyStore[page.game] ?? {}, page)); this.lastHistoryAt = Date.now(); }
    // 아는 인격 이름: 배너 자료의 픽업 + 이미지 목록의 인격·E.G.O 전체(수감자 이름이 잘못 읽힌 줄도 찾게, 2026-11-27)
    const known = [...(app.pack?.games.limbus ?? []).flatMap((b) => [...b.featured, ...b.featuredRare].map((x) => x.ko ?? "")), ...itemNames("limbus")].filter(Boolean);
    const lb = page ? null : parseLimbusHistory(f, known);
    if (lb?.length) {
      // 앞서 읽은 줄과 겹치지 않으면 그사이를 놓친 것 → 알리고, 더 긴 쪽을 남긴다
      if (!joinSequence(this.limbusRows, lb) && Date.now() - this.warnedGapAt > 10_000) {
        this.warnedGapAt = Date.now();
        app.notify("추출 이력을 너무 빨리 넘겨 중간을 놓쳤습니다. 맨 위로 돌아가 한두 칸씩 천천히 내려 주세요");
      }
      this.saveLimbus(mergeSequence(this.limbusRows, lb));
      this.lastHistoryAt = Date.now();
    }
    if (!page && !lb?.length) this.autoApplyHistories();
  }

  /** 기록 화면을 떠난 뒤 몇 초 지나면 읽어 둔 기록을 자동으로 반영한다(사용자 요청 2026-11-25) */
  private autoApplyHistories() {
    if (!this.lastHistoryAt || Date.now() - this.lastHistoryAt < 4000) return;
    this.lastHistoryAt = 0;
    for (const g of HISTORY_GAMES) {
      const rows = this.historyRowsOf(g);
      if (!rows.length) continue;
      // 직접 입력한 기록이 있으면 같은 뽑기를 두 번 셀 수 있다 → 자동 반영하지 않고 "확인할 것"에서 고르게 한다
      if (this.manualPulls(g) > 0) {
        if (this.askedManual !== g) { this.askedManual = g; app.notify(`${GAMES[g].shortName} 공식 기록을 읽었습니다. 직접 입력 기록과 겹칠 수 있어 "확인할 것"에서 반영해 주세요`); }
        continue;
      }
      // 중간 쪽을 건너뛰었으면 반영하지 않는다(사이 기록이 빠지지 않게). 읽어 둔 쪽은 남겨 두니 빠진 쪽만 보여 주면 된다
      const gap = missingPages(this.historyStore[g] ?? {});
      if (gap.length) { app.notify(`${GAMES[g].shortName} 기록 ${gap.join(", ")}쪽을 못 읽었습니다. 그 쪽을 열어 주세요`); continue; }
      const choices = Object.fromEntries([...new Set(rows.map((r) => r.banner))].map((b) => [b, g === "arknights" ? arknightsDefault(b) : ""]));
      this.applyHistory(g, choices);
    }
    if (this.limbusRows.length) this.applyLimbus();
  }

  applyHistory = (game: GameId, choices: Record<string, string>, replaceManual = false) => {
    const records = app.records;
    const out = importHistory(records, game, this.historyRowsOf(game), {
      banners: app.pack?.games[game] ?? [],
      topRarity: topRarityOf(game),
      isTop: (n) => !!sixStars[game]?.has(n),
      groupOf: (b) => choices[b] || null,
      minNamedRarity: game === "genshin" ? 4 : undefined,
      replaceManual,
      newId: () => newId("off"),
    });
    // 반영으로 최고 등급 기록이 어떻게 바뀌는지 요약한다(잘못 읽혔으면 "확인할 것"에서 바로 되돌릴 수 있게)
    const tops = (r: Records) => r.games[game].pulls.filter((p) => p.top).map((p) => `${p.name ?? "?"}@${p.time}`);
    const before = new Set(tops(records));
    const after = tops(out.records);
    const gained = after.filter((k) => !before.has(k)).map((k) => k.split("@")[0]);
    const lost = [...before].filter((k) => !after.includes(k)).map((k) => k.split("@")[0]);
    if (out.added) app.update(out.records);
    this.saveHistory(game, {});
    const change = `${gained.length ? `, ${GAMES[game].topLabel} 추가: ${gained.join("·")}` : ""}${lost.length ? `, 빠짐: ${lost.join("·")}` : ""}`;
    app.lastApply = out.added ? `${GAMES[game].shortName} 공식 기록 ${out.added}개 반영${change}` : null;
    app.notify(`${GAMES[game].shortName} 공식 기록 ${out.added}개 반영${out.replaced ? `, 기존 ${out.replaced}개 교체` : ""}${out.skipped ? `, ${out.skipped}개 제외` : ""}${change}`);
  };

  // 림버스 추출 이력: 시각이 없어 순서로 맞춘다 (limbus-history.ts)
  saveLimbus = (rows: LimbusRow[]) => {
    this.limbusRows = rows;
    writeLocal(LIMBUS_KEY, rows);
  };
  applyLimbus = () => {
    const out = applyLimbusHistory(app.records, this.limbusRows, new Date(), () => newId("lb"));
    if (out.filled || out.added) app.update(out.records);
    this.saveLimbus([]);
    app.notify(`림버스 추출 이력: ${out.filled}개 채움, ${out.added}개 추가${out.known ? `, ${out.known}개는 이미 있음` : ""}`);
  };

  // ───────── 원신 기원 기록 불러오기 (PC, DESIGN.md §4.9) ─────────

  loadGenshinWishes = async () => {
    if (this.wishBusy) return;
    this.wishBusy = true;
    this.wishMsg = "원신 기원 기록을 받는 중입니다… (처음에는 1분쯤 걸릴 수 있습니다)";
    try {
      const last = readLocal<Record<string, string>>(WISH_LAST_KEY, {});
      const fetched = await api.genshinWishes(last);
      const rows = wishRows(fetched);
      const banners = app.pack?.games.genshin ?? [];
      if (rows.length) {
        const out = importHistory(app.records, "genshin", rows, {
          banners, topRarity: 5, isTop: () => false, minNamedRarity: 4, featuredOf: wishFeatured(banners), newId: () => newId("gw"),
        });
        app.update(out.records);
        this.wishMsg = `기원 기록 ${out.added}개를 반영했습니다.`;
      } else this.wishMsg = "새 기원 기록이 없습니다.";
      writeLocal(WISH_LAST_KEY, newestIds(last, fetched.latest));
      app.notify(this.wishMsg);
    } catch (e) {
      this.wishMsg = String(e instanceof Error ? e.message : e);
      app.notify(this.wishMsg);
    } finally {
      this.wishBusy = false;
    }
  };
}
