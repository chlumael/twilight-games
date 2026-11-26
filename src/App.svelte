<script lang="ts">
  import { onMount } from "svelte";
  import { isNewer, latestRelease } from "./lib/version";
  import CurrencyBar from "./components/CurrencyBar.svelte";
  import GroupPanel from "./components/GroupPanel.svelte";
  import PityRing from "./components/PityRing.svelte";
  import DetectionCard from "./components/DetectionCard.svelte";
  import HistoryCard from "./components/HistoryCard.svelte";
  import ScreenPanel from "./components/ScreenPanel.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import StatsPanel from "./components/StatsPanel.svelte";
  import CalendarPanel from "./components/CalendarPanel.svelte";
  import { mergeMine } from "./lib/calendar";
  import PromptBar from "./components/PromptBar.svelte";
  import ForecastPanel from "./components/ForecastPanel.svelte";
  import type { IncomePlan } from "./lib/income";
  import { emptyEngineState, engineStep, type EngineAction, type EngineStatus, type RegionFrame } from "./lib/engine";
  import { PROFILES, resultCountingReady } from "./lib/screen-profile";
  import { dropPrompt, pushPrompt, type Prompt } from "./lib/prompts";
  import { newestIds, wishFeatured, wishRows } from "./lib/genshin-wish";
  import * as api from "./lib/api";
  import { GAMES, GAME_IDS, findGroup } from "./lib/games";
  import {
    availablePulls, emptyRecords, pullsFrom, groupStatus, lastSessionSize, markTopInLastSession,
    normalizeRecords, recentPulls, recordDetected, recordSession, setCurrency, spendPreview, topHistory, undo, type TopInfo, inferTopFromScreen, syncPityFromScreen, recordResult, syncBannerPulls, setSeriesOf, recordTopAt, removeBatches, recordExchange, recordFreeTop, carryToNextBanner, removeExchange, recordPullsTo, resetGroup } from "./lib/ledger";
  import { SKINS, skinStyle } from "./lib/themes";
  import { gameFingerprint, gamesToPush, mergeRecords, stampChanged } from "./lib/merge";
  import * as sync from "./lib/sync";
  import bundledPack from "../data/banners.json";
  import { autoBanner, bannerLabel, bannerPool, groupBanners, isPack, itemName, matchFeatured, newerPack, PACK_URL, type BannerPack } from "./lib/banners";
  import { currencyIcon } from "./lib/icons";
  import { looksLikeGacha, readScreen, type ScreenFrame, type ScreenReading, type SteadyCounts, normalizeFrame, steadyCounts } from "./lib/recognize";
  import { emptyDetectState, step as detectStep, type Detection, type ItemTable } from "./lib/detect";
  import genshinItemsFile from "../data/genshin-items.json";
  import endfieldSixFile from "../data/names/endfield-6star.json";
  import arknightsSixFile from "../data/names/arknights-6star.json";
  import { applyLimbusHistory, mergeSequence, parseLimbusHistory, type LimbusRow } from "./lib/limbus-history";
  import {
    importHistory, mergePages, missingPages, parseArknightsHistory, parseEndfieldHistory, parseGenshinHistory, type HistoryRow,
  } from "./lib/history";
  import { defaultSettings, normalizeSettings, pickDetectedGame, type Settings } from "./lib/settings";
  import type { Baseline, GameId, Records } from "./lib/types";

  const COLLAPSED = { w: 360, h: 44 };
  const EXPANDED = { w: 360, h: 620 };

  // $state.raw: ledger functions structuredClone these, which fails on deep proxies.
  let records = $state.raw<Records>(emptyRecords());
  let settings = $state.raw<Settings>(defaultSettings());
  let loaded = $state(false);
  let game = $state<GameId>("genshin");
  let manualGame = $state(false);
  let detection = $state<api.Detection>({ running: [], foreground: null });
  /** Running as a phone/browser web app instead of the desktop overlay. */
  const web = !api.inTauri;
  const overlay = api.androidMode === "overlay";
  let collapsed = $state(!web);
  let view = $state<"main" | "settings" | "review" | "top" | "stats" | "calendar">("main");
  /** 아래 탭 (선 아이콘: 24칸 기준 경로) */
  const TABS = [
    { id: "main", label: "홈", icon: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" },
    { id: "calendar", label: "달력", icon: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" },
    { id: "stats", label: "통계", icon: "M5 20V11M12 20V5M19 20v-6" },
    { id: "review", label: "확인", icon: "M5 12.5 10 17l9-10" },
    { id: "settings", label: "설정", icon: "M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" },
  ] as const;
  let clickThrough = $state(false);
  let toast = $state<string | null>(null);
  let newVersion = $state<string | null>(null); // PC판: 켤 때 찾은 새 버전
  let updating = $state(false);
  let updateError = $state<string | null>(null);
  async function runUpdate() {
    updating = true; updateError = null;
    try { await api.installPcUpdate(); } // 성공하면 프로그램이 꺼지고 설치가 시작된다
    catch (e) { updateError = String(e instanceof Error ? e.message : e); updating = false; }
  }
  // ---- 뽑기 감지 (화면 읽기 결과 → 확인 대기) ----
  const DETECT_KEY = "tg-detections";
  const genshinItems = ((genshinItemsFile as { items?: ItemTable }).items ?? {}) as ItemTable;
  const DETECT_STATE_KEY = "tg-detect-state";
  // 마지막으로 읽은 재화는 저장해 두었다가 다음에 이어서 쓴다(가챠 화면을 열자마자 뽑아도 셀 수 있게)
  let detectState = loadDetectState();
  function loadDetectState() {
    const base = emptyDetectState();
    try {
      const saved = JSON.parse(localStorage.getItem(DETECT_STATE_KEY) ?? "null");
      if (saved?.stable) return { ...base, stable: saved.stable, stableAt: saved.stableAt ?? {} };
    } catch { /* 없거나 깨졌으면 처음부터 */ }
    return base;
  }
  let detections = $state.raw<Detection[]>(loadDetections());
  function loadDetections(): Detection[] {
    try { return JSON.parse(localStorage.getItem(DETECT_KEY) ?? "[]") as Detection[]; } catch { return []; }
  }
  function saveDetections(list: Detection[]) {
    detections = list;
    try { localStorage.setItem(DETECT_KEY, JSON.stringify(list)); } catch { /* 저장 공간 문제는 무시 */ }
  }
  /**
   * 엔드필드 헤드헌팅 화면이 한정인지 재구축인지: 화면 글자에 그 칸의 지금 배너 픽업 이름이 보이는 쪽.
   * 둘 다 보이거나 둘 다 안 보이면 null(모름 — 추측하지 않는다).
   */
  function endfieldGroupOnScreen(f: ScreenFrame): string | null {
    const text = f.lines.map((l) => l.t.replace(/\s+/g, "")).join("\n");
    const hit = ["endfield-chartered", "endfield-refactor"].filter((gid) => {
      const b = groupBanners(pack, "endfield", gid).find((x) => x.id === records.games.endfield.currentBanner[gid]);
      return !!b && b.featured.some((it) => { const n = itemName(it).replace(/\s+/g, ""); return n.length >= 1 && text.includes(n); });
    });
    return hit.length === 1 ? hit[0] : null;
  }
  function onScreenFrame(f: ScreenFrame, r: ScreenReading | null) {
    const out = detectStep(detectState, f, r, {
      spendOf: (g) => findGroup(g, settings.activeGroup[g] ?? GAMES[g].groups[0].id).spend,
      genshinItems,
      newId: () => `det-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });
    // 두 번 연속 같게 읽힌 재화는 앱에 바로 반영한다(사용자 요청 2026-11-25)
    for (const g of GAME_IDS) {
      const now = out.state.stable[g];
      if (!now || JSON.stringify(now) === JSON.stringify(detectState.stable[g])) continue;
      const cur = records.games[g].currency;
      const diff = Object.fromEntries(Object.entries(now).filter(([k, v]) => cur[k] !== v));
      if (Object.keys(diff).length) update(setCurrency(records, g, diff));
    }
    if (out.state.stable !== detectState.stable && JSON.stringify(out.state.stable) !== JSON.stringify(detectState.stable)) {
      try { localStorage.setItem(DETECT_STATE_KEY, JSON.stringify({ stable: out.state.stable, stableAt: out.state.stableAt })); } catch { /* 무시 */ }
    }
    detectState = out.state;
    // 결과 화면으로 횟수를 세는 게임은 재화 차이로 뽑기를 기록하지 않는다(두 번 세지 않게, DESIGN.md §4.8)
    if (out.detection && !resultCountingReady(out.detection.game)) {
      // 감지되면 바로 기록한다(사용자 요청 2026-11-25). 확실하지 않은 것은 "확인"에 표시해 취소할 수 있게 한다.
      const d = out.detection;
      // 엔드필드는 화면의 픽업 이름으로 한정/재구축을 알 수 있으면 그 칸에, 아니면 골라 둔 칸에 기록한다
      const gid = (d.game === "endfield" ? endfieldGroupOnScreen(f) : null) ?? settings.activeGroup[d.game] ?? GAMES[d.game].groups[0].id;
      // 한 번에 20회를 넘거나, 확실하지 않은데 10회를 넘으면 잘못 읽은 것일 수 있다 → 기록하지 않고 "확인"에서 묻는다
      // (실제 기록이 부풀었던 문제, 2026-11-26)
      if (d.count > 20 || (d.uncertain && d.count > 10)) {
        saveDetections([...loadDetections(), d]);
        notify(`${GAMES[d.game].shortName} ${d.count}회로 읽혔습니다. 맞는지 "확인"에서 골라 주세요`);
      } else saveDetection(d, gid, d.count, true);
    }
  }
  // ---- 새 화면 인식 (PC, DESIGN.md §4.8): 정해진 위치만 잘라 읽은 결과 → 틀로 해석 → 검증 → 반영 ----
  let engineState = emptyEngineState();
  let engineStatus = $state<EngineStatus>({ kind: "idle", message: "", screen: null, at: 0 });
  /** 실패 표시는 잠깐만 (이후 성공하면 바로 지워짐) */
  const engineFailing = $derived(engineStatus.kind === "fail");
  function onRegions(frame: RegionFrame) {
    const out = engineStep(engineState, frame, PROFILES);
    engineState = out.state;
    engineStatus = out.state.status;
    for (const a of out.actions) applyEngine(a);
  }
  function applyEngine(a: EngineAction) {
    if (a.type === "currency") {
      const cur = records.games[a.game].currency;
      const diff = Object.fromEntries(Object.entries(a.values).filter(([k, v]) => cur[k] !== v));
      if (Object.keys(diff).length) update(setCurrency(records, a.game, diff));
    } else if (a.type === "pity") {
      // 규칙 7은 사용자가 뺐다(2026-11-26): 검증을 통과한 천장 값은 바로 반영한다
      const marked = inferTopFromScreen(records, a.game, a.group, a.toTop, a.toFeatured);
      if (marked !== records) notify(`${GAMES[a.game].topLabel} 획득을 화면 천장 숫자로 기록했습니다`);
      const synced = syncPityFromScreen(marked, a.game, a.group, a.toTop, a.toFeatured);
      if (synced !== records) update(synced);
    } else if (a.type === "bannerPulls") {
      const synced = syncBannerPulls(records, a.game, a.group, a.value);
      if (synced !== records) update(synced);
    } else if (a.type === "result") {
      const gid = a.group ?? settings.activeGroup[a.game] ?? GAMES[a.game].groups[0].id;
      const next = recordResult(records, a.game, gid, a.count, a.tops, new Date());
      update(next);
      const label = `${GAMES[a.game].shortName} ${findGroup(a.game, gid).name} ${a.count}회`;
      saveAutoLog([...autoLog, {
        id: `res-${Date.now()}`, game: a.game, label, pullIds: next.undo[next.undo.length - 1]?.addedPullIds ?? [], uncertain: false, time: Date.now(),
      }]);
      notify(`${label} 자동 기록 (결과 화면${a.tops.length ? `, ${GAMES[a.game].topLabel} ${a.tops.length}개` : ""})`);
      if (a.game === "genshin" && a.tops.length) askGenshinReload();
    } else if (a.type === "signal") {
      if (a.game === "genshin") askGenshinReload();
    }
  }

  // ---- 확인 창 (Ctrl+Alt+Y 예 / Ctrl+Alt+N 아니요) ----
  let prompts = $state.raw<Prompt[]>([]);
  function ask(p: Omit<Prompt, "id">) {
    prompts = pushPrompt(prompts, { ...p, id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
    collapsed = false;
  }
  function answerPrompt(yes: boolean) {
    const p = prompts[0];
    if (!p) return;
    prompts = dropPrompt(prompts, p.id);
    if (p.action.type === "genshin-reload") {
      if (yes) loadGenshinWishes();
    }
  }
  function askGenshinReload() {
    if (!api.inTauri) return;
    ask({ text: "5성이 나왔습니다. 원신 기원 기록을 새로 불러올까요?", yes: "불러오기", no: "나중에", action: { type: "genshin-reload" } });
  }

  // ---- 원신 기원 기록 불러오기 (PC, DESIGN.md §4.9) ----
  const WISH_LAST_KEY = "tg-genshin-wish-last";
  let wishBusy = $state(false);
  let wishMsg = $state("");
  async function loadGenshinWishes() {
    if (wishBusy) return;
    wishBusy = true;
    wishMsg = "원신 기원 기록을 받는 중입니다… (처음에는 1분쯤 걸릴 수 있습니다)";
    try {
      let last: Record<string, string> = {};
      try { last = JSON.parse(localStorage.getItem(WISH_LAST_KEY) ?? "{}"); } catch { /* 처음 */ }
      const fetched = await api.genshinWishes(last);
      const rows = wishRows(fetched);
      const banners = pack?.games.genshin ?? [];
      if (rows.length) {
        const out = importHistory(records, "genshin", rows, {
          banners, topRarity: 5, isTop: () => false, minNamedRarity: 4, featuredOf: wishFeatured(banners),
          newId: () => `gw-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        });
        update(out.records);
        wishMsg = `기원 기록 ${out.added}개를 반영했습니다.`;
      } else {
        wishMsg = "새 기원 기록이 없습니다.";
      }
      try { localStorage.setItem(WISH_LAST_KEY, JSON.stringify(newestIds(last, fetched.latest))); } catch { /* 무시 */ }
      notify(wishMsg);
    } catch (e) {
      wishMsg = String(e instanceof Error ? e.message : e);
      notify(wishMsg);
    } finally {
      wishBusy = false;
    }
  }

  /** 단축키 "최고 등급 떴다": 30분 안에 기록한 직전 묶음의 마지막 칸에 표시, 없으면 1회로 기록 */
  function hotkeyTop() {
    const last = rec.pulls.filter((p) => p.group === groupId).sort((a, b) => (a.time < b.time ? -1 : 1)).at(-1);
    const recent = last && Date.now() - Date.parse(last.time) < 30 * 60 * 1000;
    const size = recent ? lastSessionSize(rec, groupId) : 0;
    const session = recent ? rec.pulls.filter((p) => p.sessionId === last!.sessionId) : [];
    saveTop(size > 0 && !session.some((p) => p.top) ? size - 1 : null, { name: null, featured: null });
  }

  // ---- 공식 기록 화면 (엔드필드 헤드헌팅 기록, 원신 기원 기록, 명일방주 요스타 가챠 기록) ----
  const HISTORY_KEY = "tg-history";
  const HISTORY_GAMES: GameId[] = ["genshin", "endfield", "arknights"];
  const sixStars: Partial<Record<GameId, Set<string>>> = {
    endfield: new Set((endfieldSixFile as { names?: string[] }).names ?? []),
    arknights: new Set((arknightsSixFile as { names?: string[] }).names ?? []),
  };
  let historyStore = $state.raw<Partial<Record<GameId, Record<string, HistoryRow>>>>(loadHistory());
  function loadHistory(): Partial<Record<GameId, Record<string, HistoryRow>>> {
    try {
      const all = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}");
      const oldEndfield = JSON.parse(localStorage.getItem("tg-history-endfield") ?? "null"); // 0.6.0 저장분
      if (oldEndfield && !all.endfield) all.endfield = oldEndfield;
      return all;
    } catch { return {}; }
  }
  function saveHistory(game: GameId, store: Record<string, HistoryRow>) {
    historyStore = { ...historyStore, [game]: store };
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyStore)); localStorage.removeItem("tg-history-endfield"); } catch { /* 무시 */ }
  }
  const historyRowsOf = (g: GameId) => Object.values(historyStore[g] ?? {});
  const topRarityOf = (g: GameId) => (g === "genshin" ? 5 : 6);
  const isTopRow = (g: GameId) => (r: HistoryRow) => (r.rarity != null ? r.rarity >= topRarityOf(g) : !!sixStars[g]?.has(r.name));
  let lastHistoryAt = 0;
  /** 기록 화면을 떠난 뒤 몇 초 지나면 읽어 둔 기록을 자동으로 반영한다(사용자 요청 2026-11-25) */
  const manualPulls = (g: GameId) => records.games[g].pulls.filter((p) => p.source === "manual").length;
  let askedManual: GameId | null = null;
  function autoApplyHistories() {
    if (!lastHistoryAt || Date.now() - lastHistoryAt < 4000) return;
    lastHistoryAt = 0;
    for (const g of HISTORY_GAMES) {
      const rows = historyRowsOf(g);
      if (!rows.length) continue;
      // 중간 쪽을 건너뛰었으면 반영하지 않는다(사이 기록이 빠지지 않게). 읽어 둔 쪽은 남겨 두니 빠진 쪽만 보여 주면 된다
      // 직접 입력한 기록이 있으면 같은 뽑기를 두 번 셀 수 있다 → 자동 반영하지 않고 "확인"에서 고르게 한다
      if (manualPulls(g) > 0) {
        if (askedManual !== g) { askedManual = g; notify(`${GAMES[g].shortName} 공식 기록을 읽었습니다. 직접 입력 기록과 겹칠 수 있어 "확인"에서 반영해 주세요`); }
        continue;
      }
      const gap = missingPages(historyStore[g] ?? {});
      if (gap.length) { notify(`${GAMES[g].shortName} 기록 ${gap.join(", ")}쪽을 못 읽었습니다. 그 쪽을 열어 주세요`); continue; }
      const choices = Object.fromEntries([...new Set(rows.map((r) => r.banner))].map((b) => [b, g === "arknights" ? arknightsDefault(b) : ""]));
      applyHistory(g, choices);
    }
    if (limbusRows.length) applyLimbus();
  }
  function readHistory(f: ScreenFrame) {
    const page =
      parseEndfieldHistory(f) ??
      parseGenshinHistory(f, (n) => (genshinItems[n]?.rarity ?? null)) ??
      parseArknightsHistory(f);
    if (page?.rows.length) { saveHistory(page.game, mergePages(historyStore[page.game] ?? {}, page)); lastHistoryAt = Date.now(); }
    const lb = page ? null : parseLimbusHistory(f, limbusKnown());
    if (lb?.length) { saveLimbus(mergeSequence(limbusRows, lb)); lastHistoryAt = Date.now(); }
    if (!page && !lb?.length) autoApplyHistories();
  }
  // 림버스 추출 이력: 시각이 없어 순서로 맞춘다 (limbus-history.ts)
  const LIMBUS_KEY = "tg-history-limbus";
  let limbusRows = $state.raw<LimbusRow[]>((() => { try { return JSON.parse(localStorage.getItem(LIMBUS_KEY) ?? "[]"); } catch { return []; } })());
  function saveLimbus(rows: LimbusRow[]) {
    limbusRows = rows;
    try { localStorage.setItem(LIMBUS_KEY, JSON.stringify(rows)); } catch { /* 무시 */ }
  }
  const limbusKnown = () => (pack?.games.limbus ?? []).flatMap((b) => b.featured.map((f) => f.ko ?? "")).filter(Boolean);
  function applyLimbus() {
    const out = applyLimbusHistory(records, limbusRows, new Date(), () => `lb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    if (out.filled || out.added) update(out.records);
    saveLimbus([]);
    notify(`림버스 추출 이력: ${out.filled}개 채움, ${out.added}개 추가${out.known ? `, ${out.known}개는 이미 있음` : ""}`);
  }

  /** 명일방주 요스타 기록의 배너 이름 → 종류 처음 값 (커널·상시는 넣지 않음, 사용자가 바꿀 수 있음) */
  const arknightsDefault = (b: string) => (/커널|상시|기초|초심자/.test(b) ? "" : "arknights-limited");
  function applyHistory(game: GameId, choices: Record<string, string>, replaceManual = false) {
    const out = importHistory(records, game, historyRowsOf(game), {
      banners: pack?.games[game] ?? [],
      topRarity: topRarityOf(game),
      isTop: (n) => !!sixStars[game]?.has(n),
      groupOf: (b) => choices[b] || null,
      minNamedRarity: game === "genshin" ? 4 : undefined,
      replaceManual,
      newId: () => `off-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    });
    // 반영으로 최고 등급 기록이 어떻게 바뀌는지 요약한다(잘못 읽혔으면 "확인"에서 바로 되돌릴 수 있게)
    const tops = (r: Records) => r.games[game].pulls.filter((p) => p.top).map((p) => `${p.name ?? "?"}@${p.time}`);
    const before = new Set(tops(records));
    const after = tops(out.records);
    const gained = after.filter((k) => !before.has(k)).map((k) => k.split("@")[0]);
    const lost = [...before].filter((k) => !after.includes(k)).map((k) => k.split("@")[0]);
    if (out.added) update(out.records);
    saveHistory(game, {});
    const change = `${gained.length ? `, ${GAMES[game].topLabel} 추가: ${gained.join("·")}` : ""}${lost.length ? `, 빠짐: ${lost.join("·")}` : ""}`;
    lastApply = out.added ? `${GAMES[game].shortName} 공식 기록 ${out.added}개 반영${change}` : null;
    notify(`${GAMES[game].shortName} 공식 기록 ${out.added}개 반영${out.replaced ? `, 기존 ${out.replaced}개 교체` : ""}${out.skipped ? `, ${out.skipped}개 제외` : ""}${change}`);
  }

  /** 방금 반영한 공식 기록 요약 ("확인" 화면에서 되돌릴 수 있게 보여 준다) */
  let lastApply = $state<string | null>(null);
  function undoLastApply() {
    doUndo();
    lastApply = null;
  }

  // ---- 자동 기록 목록 (취소·확인용) ----
  interface AutoEntry { id: string; game: GameId; label: string; pullIds: string[]; uncertain: boolean; time: number }
  const AUTO_KEY = "tg-auto-log";
  let autoLog = $state.raw<AutoEntry[]>((() => { try { return JSON.parse(localStorage.getItem(AUTO_KEY) ?? "[]"); } catch { return []; } })());
  function saveAutoLog(list: AutoEntry[]) {
    autoLog = list.slice(-20);
    try { localStorage.setItem(AUTO_KEY, JSON.stringify(autoLog)); } catch { /* 무시 */ }
  }
  /** 자동 기록 취소: 그때 넣은 뽑기를 지운다(재화는 화면에서 읽은 값 그대로 둔다) */
  function cancelAuto(e: AutoEntry) {
    const next = structuredClone(records);
    const ids = new Set(e.pullIds);
    next.games[e.game].pulls = next.games[e.game].pulls.filter((p) => !ids.has(p.id));
    update(next);
    saveAutoLog(autoLog.filter((x) => x.id !== e.id));
    notify(`${e.label} 취소`);
  }

  function saveDetection(d: Detection, gid: string, count: number, auto = false) {
    const top = d.game === "genshin" ? 5 : 6;
    const banner = groupBanners(pack, d.game, gid).find((b) => b.id === records.games[d.game].currentBanner[gid]);
    // 3성은 기록하지 않는다(사용자 요청). 4성 이상만 이름·등급을 남긴다.
    const items = d.items.filter((i) => i.rarity >= 4).map((i) => ({
      name: i.name, rarity: i.rarity, top: i.rarity >= top, featured: i.rarity >= top ? matchFeatured(banner, i.name) : null,
    }));
    const next = recordDetected(records, d.game, gid, count, items, d.after, new Date(d.time));
    update(next);
    saveDetections(loadDetections().filter((x) => x.id !== d.id));
    const label = `${GAMES[d.game].shortName} ${findGroup(d.game, gid).name} ${count}회`;
    if (auto) {
      saveAutoLog([...autoLog, {
        id: d.id, game: d.game, label, pullIds: next.undo[next.undo.length - 1]?.addedPullIds ?? [], uncertain: d.uncertain, time: d.time,
      }]);
      notify(`${label} 자동 기록${d.uncertain ? " (확실하지 않음 — \"확인\"에서 취소 가능)" : ""}`);
    } else {
      notify(`${label} 기록 완료`);
    }
  }
  function guessFeaturedFor(g: GameId, gid: string, name: string): boolean | null {
    const banner = groupBanners(pack, g, gid).find((b) => b.id === records.games[g].currentBanner[gid]);
    return matchFeatured(banner, name);
  }

  let screenOn = $state(!!api.android?.screenReading?.());
  let screenMessage = $state("");
  let screenFrame = $state.raw<ScreenFrame | null>(null);
  let screenResult = $state.raw<ScreenReading | null>(null);
  let steady: { game: GameId; counts: SteadyCounts } | null = null;
  let pack = $state.raw<BannerPack | null>(isPack(bundledPack) ? bundledPack : null);

  // 엔드필드 재구축: 120 픽업 확정·누적 횟수는 같은 시리즈(같은 이름) 배너끼리 이어서 센다
  $effect(() => {
    const series = new Map<string, string>();
    // 시리즈 = 데이터의 series, 없으면 엔드필드 재구축은 배너 이름의 「」 안(공식: 같은 이름 #1, #2…끼리 계승)
    for (const list of Object.values(pack?.games ?? {})) for (const b of list) {
      const named = b.group.startsWith("endfield-refactor") ? b.name.match(/「([^」]+)」/)?.[1] : undefined;
      const sr = b.series ?? named;
      if (sr) series.set(b.id, sr);
    }
    setSeriesOf((id) => series.get(id) ?? id);
  });
  const def = $derived(GAMES[game]);
  const skin = $derived(SKINS[game]);
  const rec = $derived(records.games[game]);
  const groupId = $derived(settings.activeGroup[game] ?? def.groups[0].id);
  const group = $derived(findGroup(game, groupId));
  const status = $derived(groupStatus(rec, game, groupId));
  const canPull = $derived(availablePulls(rec.currency, group.spend));
  const included = $derived(
    // 직접 입력 재화와, 바꿔서 쓰는 재화(창세의 결정·파생 오리지늄·오리지늄)가 몇 회분인지 따로 보여 준다
    def.currencies.filter((c) => c.manualOnly || group.spend.some((st) => st.topUp?.key === c.key))
      .map((c) => ({ label: c.label, pulls: pullsFrom(rec.currency, group.spend, c.key) })),
  );
  const pending = $derived(
    detections.length + (lastApply ? 1 : 0) + autoLog.filter((e) => e.uncertain).length + (limbusRows.length ? 1 : 0) + HISTORY_GAMES.filter((g) => Object.keys(historyStore[g] ?? {}).length).length + GAME_IDS.reduce((n, id) => n + records.games[id].pulls.filter((p) => p.status === "pending").length, 0),
  );
  const recent = $derived(recentPulls(rec, groupId, 40));
  const hits = $derived(topHistory(rec, groupId));
  const banners = $derived(groupBanners(pack, game, groupId));
  /** 기록에 저장된 배너 ID를 보여 줄 이름으로 바꾼다 (팩에 없으면 그대로). */
  function packBannerName(id: string): string {
    const b = (pack?.games[game] ?? []).find((x) => x.id === id);
    return b ? `${bannerLabel(b)} · ${b.name}` : id;
  }
  const currentPackBanner = $derived(banners.find((b) => b.id === status.banner));

  // Follow the banner schedule: switch groups to the running banner unless the user typed one.
  $effect(() => {
    if (!loaded || !pack) return;
    let next: Records | null = null;
    for (const id of GAME_IDS) {
      for (const g of GAMES[id].groups) {
        let cur = (next ?? records).games[id].currentBanner[g.id] ?? "";
        const list = groupBanners(pack, id, g.id);
        // 배너가 다른 종류로 옮겨졌으면(예: 명일방주 콜라보 분리) 이 종류에서는 비운다
        if (cur && !list.some((b) => b.id === cur) && (pack.games[id] ?? []).some((b) => b.id === cur)) {
          next ??= structuredClone(records);
          next.games[id].currentBanner[g.id] = "";
          cur = "";
        }
        const to = autoBanner(list, cur);
        if (to) {
          next ??= structuredClone(records);
          // 더 뒤에 열린 배너로 넘어갈 때만: 배너 전용 재화 소멸, 지난 배너의 "다음 배너 보상" 지급 (엔드필드 정보서)
          const from = list.find((b) => b.id === cur);
          const into = list.find((b) => b.id === to);
          if (from?.start && into?.start && into.start > from.start) {
            const out = carryToNextBanner(next, id, g.id);
            next = out.records;
            if (out.notes.length) notify(`${GAMES[id].shortName} 새 배너: ${out.notes.join(", ")}`);
          }
          next.games[id].currentBanner[g.id] = to;
        }
      }
    }
    if (next) records = next;
  });

  function notify(msg: string) {
    toast = msg;
    setTimeout(() => (toast === msg ? (toast = null) : null), 2500);
  }

  function update(next: Records) {
    records = stampChanged(records, next);
  }

  // ---- tracker account (sync) ----
  let account = $state<sync.Account | null>(null);
  let syncState = $state<"idle" | "syncing" | "ok" | "error">("idle");
  let lastSync = $state<string | null>(null);
  const pushedKey = (uid: string) => `tg-sync-pushed-${uid}`;
  const linkedKey = (uid: string) => `tg-sync-linked-${uid}`;
  function readJson<T>(key: string, fallback: T): T {
    try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
  }

  /** Pull the account's copy, merge it in, push whatever is newer here. */
  async function syncNow() {
    const a = account;
    if (!a || syncState === "syncing") return;
    syncState = "syncing";
    try {
      const remote = await sync.pullAll(a.uid);
      const firstLink = localStorage.getItem(linkedKey(a.uid)) !== "1";
      const merged = mergeRecords(records, remote.games, firstLink ? "union" : "newer");
      if (firstLink && remote.settings) settings = normalizeSettings(remote.settings);
      else if (remote.settings) {
        // 달력의 내 일정은 기기끼리 합친다(그 밖의 설정은 기기마다 따로)
        const r = normalizeSettings(remote.settings);
        const removed = [...new Set([...(settings.calendarRemoved ?? []), ...(r.calendarRemoved ?? [])])];
        settings = { ...settings, calendar: mergeMine(settings.calendar ?? [], r.calendar ?? [], removed), calendarRemoved: removed };
      }
      records = merged;
      const pushed: Record<string, string> = {};
      for (const id of GAME_IDS) if (remote.games[id]) pushed[id] = gameFingerprint(remote.games[id]!);
      await pushPending(a.uid, pushed);
      await sync.pushSettings(a.uid, settings);
      localStorage.setItem(linkedKey(a.uid), "1");
      syncState = "ok";
      lastSync = new Date().toISOString();
    } catch (e) {
      syncState = "error";
      notify(`동기화 실패: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function pushPending(uid: string, known?: Record<string, string>) {
    const pushed = known ?? readJson<Record<string, string>>(pushedKey(uid), {});
    for (const id of gamesToPush(records, pushed)) {
      await sync.pushGame(uid, id, records.games[id]);
      pushed[id] = gameFingerprint(records.games[id]);
    }
    localStorage.setItem(pushedKey(uid), JSON.stringify(pushed));
  }

  // Push local edits a moment after they happen.
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const _r = records;
    const a = account;
    if (!loaded || !a) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        await pushPending(a.uid);
        lastSync = new Date().toISOString();
        syncState = "ok";
      } catch {
        syncState = "error"; // retried on the next change or sync
      }
    }, 2000);
  });

  async function signInAccount() {
    try {
      account = await sync.signIn();
      await syncNow();
      notify("로그인했습니다. 기록이 계정에 저장됩니다");
    } catch (e) {
      notify(`로그인 실패: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function signOutAccount() {
    await sync.signOutAccount();
    account = null;
    syncState = "idle";
    notify("로그아웃했습니다. 이 기기의 기록은 그대로 남습니다");
  }

  function changeSettings(next: Settings) {
    settings = next;
  }

  // Persist on change (debounced).
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const r = records;
    const s = settings;
    if (!loaded) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await api.writeStore("records", JSON.stringify(r));
        await api.writeStore("settings", JSON.stringify(s));
      } catch (e) {
        notify(`저장 실패: ${e}`);
      }
    }, 300);
  });

  $effect(() => {
    document.documentElement.style.setProperty("--bg-alpha", String(settings.opacity));
  });

  $effect(() => {
    if (loaded) api.setProcessMap(settings.processNames);
  });

  $effect(() => {
    if (web) return;
    const size = collapsed ? COLLAPSED : EXPANDED;
    api.resizeWindow(size.w, size.h);
  });

  function switchGame(id: GameId) {
    game = id;
    // 확인·통계·설정 화면은 게임을 바꿔도 그대로 둔다. 최고 등급 입력 창만 그 게임 것이라 닫는다.
    if (view === "top") view = "main";
    settings = { ...settings, lastGame: id };
  }

  const GAME_ICON: Record<GameId, string> = { genshin: "intertwined", arknights: "orundum", endfield: "oroberyl", limbus: "lunacy" };

  let bodyEl = $state<HTMLDivElement>();
  $effect(() => {
    game; groupId;
    bodyEl?.scrollTo({ top: 0 });
  });

  function selectGame(value: string) {
    if (value === "auto") {
      manualGame = false;
      game = pickDetectedGame(detection.running, detection.foreground, game);
    } else {
      manualGame = true;
      game = value as GameId;
    }
    settings = { ...settings, lastGame: game };
  }

  function selectGroup(id: string) {
    settings = { ...settings, activeGroup: { ...settings.activeGroup, [game]: id } };
  }

  function pull(count: number) {
    update(recordSession(records, game, groupId, count));
    notify(`${group.name} ${count}회 기록`);
  }

  function saveTop(position: number | null, info: TopInfo) {
    try {
      update(position === null
        ? recordSession(records, game, groupId, 1, new Map([[0, info]]))
        : markTopInLastSession(records, game, groupId, position, info));
      view = "main";
      notify(`${def.topLabel} 기록 완료`);
    } catch (e) {
      notify(String(e instanceof Error ? e.message : e));
    }
  }

  function doUndo() {
    const r = undo(records);
    if (!r.label) return notify("되돌릴 기록이 없습니다");
    update(r.records);
    notify(`되돌림: ${r.label}`);
  }

  function editCurrency(key: string, value: string) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    update(setCurrency(records, game, { [key]: n }));
  }

  function setBanner(name: string) {
    const next = structuredClone(records);
    next.games[game].currentBanner[groupId] = name;
    update(next);
  }

  /** 직접 입력 "이 배너에서 n번째에 이름" (배너 누적, 사용자 2026-11-26). 픽업 여부는 배너의 픽업 이름과 같은지로 */
  function saveTopAt(n: number, name: string) {
    const out = recordTopAt(records, game, groupId, n, { name: name || null, featured: name ? matchFeatured(currentPackBanner, name) : null });
    const what = name || def.topLabel;
    if (out.mode === "added" || out.mode === "marked") {
      update(out.records);
      notify(`배너 ${n}번째 ${what} 기록`);
    } else if (out.mode === "too-far") {
      notify(`지금 기록(${status.bannerPulls}번째)에서 너무 멉니다. 그 사이에 나온 ${def.topLabel}부터 순서대로 넣어 주세요`);
    } else if (out.mode === "before") {
      notify("앱에 기록하기 전 구간입니다. 설정의 시작 상태에서 맞춰 주세요");
    } else notify("숫자를 다시 확인해 주세요");
  }
  /** 원신 무기·묶음 기원에서 고른 무기 (신의 궤도·묶음 궤도) */
  function setChosen(name: string) {
    const next = structuredClone(records);
    const chosen = { ...(next.games[game].chosen ?? {}) };
    if (name) chosen[groupId] = { banner: status.banner, name }; else delete chosen[groupId];
    next.games[game].chosen = chosen;
    update(next);
  }
  /** 종류별 "픽업이 목록에 남는 배너 수" 규칙 (games.ts의 rotation) */
  const rotationRules = $derived(Object.fromEntries(def.groups.filter((g) => g.rotation).map((g) => [g.id, g.rotation!.stays])));
  /** 지금 배너에서 나올 수 있는 최고 등급과, 각각 몇 배너 더 나오는지 (규칙이 있는 종류만) */
  const poolInfo = $derived(currentPackBanner && rotationRules[groupId] ? bannerPool(pack?.games[game] ?? [], currentPackBanner, rotationRules) : null);
  /** 이름 후보: 지금 배너 픽업 → 그 배너에서 나올 수 있는 것(있으면) → 이 종류의 최고 등급 이름들 */
  const topNames = $derived.by(() => {
    const featured = (currentPackBanner?.featured ?? []).map(itemName);
    // 배너에 정해진 목록(공식 6성 목록)이 있거나 규칙으로 만들 수 있으면 그것만 (엔드필드)
    const pool = poolInfo ? poolInfo.entries.filter((e) => !e.featured).map((e) => e.name) : (currentPackBanner?.pool ?? []).map(itemName);
    let all: string[];
    if (pool.length) all = pool;
    else if (game === "genshin" && !group.onlyListed) {
      // 캐릭터 기원은 캐릭터, 무기 기원은 무기, 묶음 기원은 배너에 적힌 것만
      const kind = groupId === "genshin-char" ? "character" : groupId === "genshin-weapon" ? "weapon" : null;
      all = Object.entries(genshinItems).filter(([, v]) => v.rarity === 5 && (!kind || v.kind === kind)).map(([k]) => k);
    } else if (group.onlyListed || groupId === "endfield-arsenal" || groupId === "endfield-refactor-arsenal") all = []; // 배너에 적힌 것만 / 무기 배너에 오퍼레이터 이름을 섞지 않는다
    else all = [...(sixStars[game] ?? [])];
    return [...new Set([...featured, ...all])];
  });

  function setIncomePlan(plan: IncomePlan) {
    const next = structuredClone(records);
    next.games[game].income = plan;
    update(next);
  }

  function setBaseline(gid: string, b: Baseline) {
    const next = structuredClone(records);
    next.games[game].baseline[gid] = b;
    update(next);
  }

  async function exportData() {
    const path = await api.exportBackup(JSON.stringify(records, null, 2));
    if (path) notify("백업을 저장했습니다");
  }

  async function importData() {
    const text = await api.importBackup();
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.schemaVersion !== 1) throw new Error("황혼 게임즈 백업 파일이 아닙니다");
      update(normalizeRecords(parsed));
      notify("백업을 불러왔습니다");
    } catch (e) {
      notify(`가져오기 실패: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Use the newest of: bundled pack, cached pack, published pack. Offline is fine. */
  async function refreshPack() {
    try {
      const cached = await api.readStore("banners");
      const c = cached ? JSON.parse(cached) : null;
      if (isPack(c)) pack = newerPack(pack, c);
    } catch {
      /* ignore a broken cache */
    }
    try {
      const res = await fetch(PACK_URL, { cache: "no-store" });
      const remote = res.ok ? await res.json() : null;
      if (isPack(remote) && newerPack(pack, remote) === remote) {
        pack = remote;
        await api.writeStore("banners", JSON.stringify(remote));
      }
    } catch {
      /* offline: keep what we have */
    }
  }

  // Android overlay: keep the native collapsed bar (pity · 확정 · 가능 횟수) in sync.
  $effect(() => {
    if (api.androidMode !== "overlay" || !api.android?.updateSummary) return;
    const v = skin.vars;
    const hex = (rgb: string) => "#" + rgb.split(",").map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    api.android.updateSummary(JSON.stringify({
      game: def.shortName,
      group: group.name,
      pity: status.pity,
      hard: status.hardPity,
      guaranteed: status.guaranteed === true,
      canPull,
      bg: hex(v["--bg-rgb"]),
      text: v["--text"],
      accent: v["--a2"],
      top: v["--top"],
    }));
  });

  /** Re-read storage: another window (app ↔ overlay) may have saved meanwhile. */
  async function reloadFromStorage() {
    try {
      const [r, s] = await Promise.all([api.readStore("records"), api.readStore("settings")]);
      if (r) records = normalizeRecords(JSON.parse(r));
      if (s) settings = normalizeSettings(JSON.parse(s));
    } catch {
      /* keep current state */
    }
  }

  onMount(() => {
    // 화면 읽기 결과 받기 (안드로이드 오버레이). 창이 접혀 있어도 계속 받는다.
    const sw = window as unknown as { __twilightScreen?: (j: string) => void; __twilightScreenState?: (j: string) => void };
    sw.__twilightScreen = (json) => {
      try {
        const raw = JSON.parse(json) as ScreenFrame;
        const f = normalizeFrame(raw); // 자주 틀리게 읽히는 낱말을 바로잡은 것 (복사용은 원본 그대로 둔다)
        screenOn = true;
        const r = readScreen(f);
        // "읽은 글자 복사"용으로는 게임 가챠 화면으로 보이는 것만 남긴다.
        // (화면 읽기는 켜져 있는 동안 다른 앱 화면도 읽으므로, 다른 앱 글자를 붙잡아 두지 않는다)
        // PC는 원인을 볼 수 있게 마지막으로 읽은 화면을 항상 남긴다(다른 프로그램을 앞에 두면 그것도 읽으니 주의 문구를 띄운다).
        if (r || looksLikeGacha(f) || api.inTauri) screenFrame = raw;
        onScreenFrame(f, r);
        if (!r) readHistory(f);
        if (r) {
          // 이번에 일부를 못 읽었으면(가려짐 등) 같은 게임에서 직전에 읽은 값을 남겨 둔다
          if (screenResult?.game === r.game) r.currency = { ...screenResult.currency, ...r.currency };
          // 천장까지 남은 횟수는 두 번 연속 같게 읽힌 값만 보여 준다 ("53"이 "3"으로 읽혀 왔다 갔다 하던 문제)
          const counts = steadyCounts(steady?.game === r.game ? steady.counts : null, r);
          steady = { game: r.game, counts };
          r.toTop = counts.shown.toTop;
          r.toFeatured = counts.shown.toFeatured;
          // 엔드필드 한정 배너 화면(픽업 확정 문구가 함께 보일 때)에 적힌 남은 횟수로 앱의 천장 수치를 맞춘다
          // (사용자 요청 2026-11-25). 두 번 연속 같게 읽힌 값만 쓴다.
          // 재화 변화가 아직 확인 중이면(방금 뽑은 것이 기록되기 전) 기다린다. 먼저 맞추면 직전 묶음에 잘못 붙는다.
          const stableNow = detectState.stable.endfield ?? {};
          const currencySettled = Object.entries(r.currency).every(([k, v]) => stableNow[k] === v);
          // 한정·재구축 화면이 같은 문구를 쓰므로, 화면에 보이는 픽업 이름이 어느 배너 것인지 확인된 때만 그 칸에 맞춘다
          const efGroup = r.game === "endfield" ? endfieldGroupOnScreen(f) : null;
          if (efGroup && counts.settled && r.toFeatured !== null && currencySettled) {
            // 천장이 다시 시작됐으면(6성 나옴) 방금 뽑은 묶음에서 그 자리를 표시하고, 남은 차이는 기준값으로 맞춘다
            const marked = inferTopFromScreen(records, "endfield", efGroup, r.toTop, r.toFeatured);
            if (marked !== records) notify("6성 획득을 화면 천장 숫자로 기록했습니다 (이름은 헤드헌팅 기록 화면에서 채워집니다)");
            const synced = syncPityFromScreen(marked, "endfield", efGroup, r.toTop, r.toFeatured);
            if (synced !== records) update(synced);
          }
          screenResult = r;
          // 읽은 화면이 다른 게임이면 그 게임으로 바꾼다 (기록은 건드리지 않는다)
          if (r.game !== game) { game = r.game; settings = { ...settings, lastGame: r.game }; }
        }
      } catch { /* 깨진 데이터는 버린다 */ }
    };
    sw.__twilightScreenState = (json) => {
      try {
        const st = JSON.parse(json) as { state: string; message: string };
        screenOn = st.state === "started";
        screenMessage = st.state === "denied" ? "화면 녹화를 허용하지 않아 시작하지 못했습니다."
          : st.state === "error" ? `시작하지 못했습니다: ${st.message}` : "";
      } catch { /* 무시 */ }
    };
    (window as unknown as { __twilightReload?: () => void }).__twilightReload = () => {
      if (loaded) reloadFromStorage();
    };
    const onVisible = async () => {
      if (document.visibilityState !== "visible" || !loaded) return;
      await reloadFromStorage();
      if (account) syncNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    const unlisten: Promise<() => void>[] = [];
    let unwatch = () => {};
    (async () => {
      try {
        const [r, s] = await Promise.all([api.readStore("records"), api.readStore("settings")]);
        records = normalizeRecords(r ? JSON.parse(r) : null);
        settings = normalizeSettings(s ? JSON.parse(s) : null);
        game = settings.lastGame;
      } catch (e) {
        notify(`불러오기 실패: ${e}`);
      }
      loaded = true;
      unwatch = sync.watchAccount((a) => {
        const was = account?.uid;
        account = a;
        if (a && a.uid !== was) syncNow();
      });
      await refreshPack();
    })();
    unlisten.push(api.onEvent<api.Detection>("game-detected", (d) => {
      detection = d;
      if (!manualGame && (d.foreground || d.running.length)) {
        game = pickDetectedGame(d.running, d.foreground, game);
      }
    }));
    unlisten.push(api.onEvent<boolean>("click-through", (on) => (clickThrough = on)));
    // PC판: 같은 처리기를 Tauri 이벤트에 연결하고, 켤 때 화면 읽기를 함께 시작한다
    if (api.inTauri) {
      unlisten.push(api.onEvent<ScreenFrame>("screen-text", (f) => sw.__twilightScreen?.(JSON.stringify(f))));
      unlisten.push(api.onEvent<{ state: string; message: string }>("screen-state", (st) => sw.__twilightScreenState?.(JSON.stringify(st))));
      unlisten.push(api.onEvent<RegionFrame>("screen-regions", onRegions));
      api.setScreenProfiles(PROFILES);
      api.screenRead(true);
      // 켤 때 새 버전을 확인하고, 있으면 창을 펼쳐 알린다
      void api.pcVersion().then(async (cur) => {
        const r = cur ? await latestRelease() : null;
        if (cur && r && r.hasPc && isNewer(r.version, cur)) { newVersion = r.version; collapsed = false; }
      });
    }
    unlisten.push(api.onEvent<string>("hotkey", (action) => {
      if (action === "toggle-collapse") collapsed = !collapsed;
      else if (action === "open-review") { collapsed = false; view = "review"; }
      else if (action === "undo") doUndo();
      else if (action === "pull-1") pull(1);
      else if (action === "pull-10") pull(10);
      else if (action === "top") hotkeyTop();
      else if (action === "prompt-yes") answerPrompt(true);
      else if (action === "prompt-no") answerPrompt(false);
    }));
    return () => {
      unwatch();
      document.removeEventListener("visibilitychange", onVisible);
      unlisten.forEach((p) => p.then((f) => f()));
    };
  });
</script>

<main class:collapsed class:web class:overlay data-skin={game} style={skinStyle(game)}>
  {#if collapsed}
    <div class="line" data-tauri-drag-region ondblclick={() => (collapsed = false)} role="presentation">
      <span class="stripe" data-tauri-drag-region></span>
      <PityRing value={status.pity} max={status.hardPity} soft={status.softFrom} label="" size={30} />
      <strong class="gname" data-tauri-drag-region>{def.shortName}</strong>
      <span class="muted" data-tauri-drag-region>{group.name}</span>
      {#if status.guaranteed}<span class="good" data-tauri-drag-region>확정</span>{/if}
      <span class="have" data-tauri-drag-region>{canPull}<small>뽑</small></span>
      {#if pending}<span class="warn" data-tauri-drag-region>확인 {pending}</span>{/if}
      {#if engineFailing}<span class="warn small" data-tauri-drag-region title={engineStatus.message}>인식 못 함</span>{/if}
      {#if prompts.length}<span class="warn" data-tauri-drag-region>질문 {prompts.length}</span>{/if}
      {#if newVersion}<span class="warn" data-tauri-drag-region>새 버전</span>{/if}
      {#if clickThrough}<span class="muted" data-tauri-drag-region title="클릭 통과 중 (Ctrl+Alt+T)">⇣</span>{/if}
      <button class="icon expand" onclick={() => (collapsed = false)} aria-label="펼치기">▾</button>
    </div>
  {:else}
    {#if newVersion}
      <div class="update">
        {#if updating}
          <span>새 버전을 받는 중… 곧 설치가 시작됩니다</span>
        {:else}
          <span>{updateError ?? `새 버전 ${newVersion}이 있습니다`}</span>
          <button onclick={runUpdate}>{updateError ? "다시 시도" : "업데이트"}</button>
          {#if updateError}<button onclick={() => api.openPcDownload()}>직접 받기</button>{/if}
          <button class="later" onclick={() => (newVersion = null)}>나중에</button>
        {/if}
      </div>
    {/if}
    {#if prompts.length}<PromptBar prompt={prompts[0]} pc={api.inTauri} onAnswer={answerPrompt} />{/if}
    {#if engineFailing}<div class="engine-fail" title={engineStatus.message}>{engineStatus.message}</div>{/if}
    <header data-tauri-drag-region>
      <div class="brand" data-tauri-drag-region>
        <span class="brand-title" data-tauri-drag-region>{skin.title}</span>
        <span class="brand-sub" data-tauri-drag-region>
          {skin.sub} ·
          {#if web}
            {def.name}
          {:else}
            <select class="game-select" value={manualGame ? game : "auto"} onchange={(e) => selectGame((e.currentTarget as HTMLSelectElement).value)}>
              <option value="auto">{def.name} (자동)</option>
              {#each GAME_IDS as id}<option value={id}>{GAMES[id].name}</option>{/each}
            </select>
          {/if}
        </span>
      </div>
      <span class="spacer" data-tauri-drag-region></span>
      {#if clickThrough}<span class="muted small">통과</span>{/if}
      {#if !web}<button class="icon" onclick={() => { collapsed = true; view = "main"; }} aria-label="접기">▴</button>{/if}
      {#if api.androidMode === "app"}
        <button class="icon launch" onclick={() => api.android?.startOverlay()} title="게임 위에 띄우기">⧉ 띄우기</button>
      {/if}
    </header>
    {#if web}
      <nav class="games" aria-label="게임 선택">
        {#each GAME_IDS as id (id)}
          {@const ic = currencyIcon(id, GAME_ICON[id])}
          <button class:active={id === game} onclick={() => switchGame(id)}>
            {#if ic}<img src={ic} alt="" />{/if}<span>{GAMES[id].shortName}</span>
          </button>
        {/each}
      </nav>
    {/if}

    <div class="body" bind:this={bodyEl}>
      {#if view === "settings"}
        <SettingsPanel
          {settings} {game} {web} record={rec}
          onSettings={changeSettings} onBaseline={setBaseline}
          onExport={exportData} onImport={importData} onClose={() => (view = "main")}
          syncConfigured={sync.syncConfigured} {account} {syncState} {lastSync}
          onSignIn={signInAccount} onSignOut={signOutAccount} onSync={syncNow}
          onGenshinWishes={api.inTauri ? loadGenshinWishes : undefined} genshinWishBusy={wishBusy} genshinWishMsg={wishMsg}
        />
      {:else if view === "calendar"}
        <CalendarPanel {pack} {game} mine={settings.calendar ?? []} onClose={() => (view = "main")}
          onMine={(list) => {
            const gone = (settings.calendar ?? []).filter((m) => !list.some((x) => x.id === m.id)).map((m) => m.id);
            changeSettings({ ...settings, calendar: list, calendarRemoved: [...new Set([...(settings.calendarRemoved ?? []), ...gone])].slice(-500) });
            if (account) setTimeout(() => void syncNow(), 800);
          }} />
      {:else if view === "stats"}
        <StatsPanel {game} record={rec} bannerName={packBannerName} onClose={() => (view = "main")}
          onReset={(gid) => { update(resetGroup(records, game, gid)); lastApply = `${findGroup(game, gid).name} 기록 전부 지우기`; notify(`${findGroup(game, gid).name} 기록을 지웠습니다. 뽑기는 "확인"에서 되돌릴 수 있습니다`); }}
          onRemove={(keys, label) => { update(removeBatches(records, game, keys, label)); lastApply = label; notify(`${label} — "확인"에서 되돌릴 수 있습니다`); }} />
      {:else if view === "review"}
        <section class="review">
          <strong>확인 대기</strong>
          {#if lastApply}
            <div class="card autolog">
              <div class="arow"><span>{lastApply}</span><span class="abtn"><button onclick={undoLastApply}>되돌리기</button><button onclick={() => (lastApply = null)}>확인</button></span></div>
            </div>
          {/if}
          {#if pending === 0}
            <p class="muted">확인할 기록이 없습니다.</p>
          {/if}
          {#each HISTORY_GAMES.filter((g) => historyRowsOf(g).length) as g (g)}
            <HistoryCard game={g} rows={historyRowsOf(g)} hideBelow={g === "genshin" ? 4 : 0} isTop={isTopRow(g)} needsChoice={g === "arknights"}
              defaultGroup={g === "arknights" ? arknightsDefault : undefined}
              manualCount={manualPulls(g)}
              onApply={(choices, replaceManual) => applyHistory(g, choices, replaceManual)} onClear={() => saveHistory(g, {})} />
          {/each}
          {#if autoLog.length}
            <div class="card autolog">
              <b>자동으로 기록한 뽑기</b>
              {#each [...autoLog].reverse() as e (e.id)}
                <div class="arow" class:unsure={e.uncertain}>
                  <span>{new Date(e.time).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} {e.label}{e.uncertain ? " · 확실하지 않음" : ""}</span>
                  <span class="abtn">
                    <button onclick={() => cancelAuto(e)}>취소</button>
                    <button onclick={() => saveAutoLog(autoLog.filter((x) => x.id !== e.id))}>확인</button>
                  </span>
                </div>
              {/each}
              <p class="muted lbsmall">잘못 잡힌 것만 "취소"하세요. "확인"은 목록에서 지우기만 합니다(기록은 그대로).</p>
            </div>
          {/if}
          {#if limbusRows.length}
            <div class="card lbhist">
              <div class="lbhead"><b>림버스 추출 이력 {limbusRows.length}개 읽음</b><span class="muted">000 {limbusRows.filter((r) => r.top).length}개</span></div>
              <p class="muted lbsmall">최신이 위. 이력에는 시각이 없어서 앱의 최근 뽑기(감지·직접 입력)에 위에서부터 이름·000을 채우고, 앱이 모르던 줄은 지금 시각으로 넣습니다. 아래로 내리며 1초씩 보여 주면 이어 붙습니다.</p>
              <div class="lblist">{#each limbusRows as r, i (i)}<div class:top={r.top}>{r.top ? "000 " : ""}{r.name}</div>{/each}</div>
              <div class="lbact"><button class="save" onclick={applyLimbus}>기록에 반영</button><button onclick={() => saveLimbus([])}>비우기</button></div>
            </div>
          {/if}
          {#each detections as d (d.id)}
            <DetectionCard detection={d} defaultGroup={settings.activeGroup[d.game] ?? GAMES[d.game].groups[0].id}
              guessFeatured={(gid, name) => guessFeaturedFor(d.game, gid, name)}
              onSave={(gid, count) => saveDetection(d, gid, count)}
              onDiscard={() => saveDetections(loadDetections().filter((x) => x.id !== d.id))} />
          {/each}
          <ScreenPanel {game} currency={rec.currency} reading={screenOn} message={screenMessage} frame={screenFrame} result={screenResult}
            onCurrency={(values) => update(setCurrency(records, game, values))} />
          <button onclick={() => (view = "main")}>닫기</button>
        </section>
      {:else}
        <CurrencyBar {game} currencies={def.currencies} values={rec.currency} {canPull} {included} onEdit={editCurrency} />

        {#if def.groups.length > 1}
        <nav class="tabs">
          {#each def.groups as g (g.id)}
            <button class:active={g.id === groupId} onclick={() => selectGroup(g.id)}>{g.name}</button>
          {/each}
        </nav>
        {/if}

        <GroupPanel {status} groupLabel={group.name} topLabel={def.topLabel} {recent} {hits} gauge={skin.gauge} {banners} onBanner={setBanner}
          {topNames} guessFeatured={(n) => matchFeatured(currentPackBanner, n)} onTopAt={saveTopAt}
          chooseOptions={group.featuredRule === "fate-point" ? (currentPackBanner?.featured ?? []).map(itemName) : []}
          chosen={rec.chosen?.[groupId]?.banner === status.banner ? rec.chosen[groupId].name : ""} onChoose={setChosen}
          exchanges={(rec.exchanges ?? []).filter((e) => e.group === groupId && e.banner === status.banner)}
          onExchange={(name) => { update(recordExchange(records, game, groupId, name || null)); notify(`${name || def.topLabel} 교환 기록`); }}
          onRemoveExchange={(id) => update(removeExchange(records, game, id))}
          poolOf={(b) => (rotationRules[b.group] || b.pool?.length ? bannerPool(pack?.games[game] ?? [], b, rotationRules) : null)}
          freeLabel={group.freeLabel ?? ""}
          share={group.featuredShare ?? 0.5}
          onFreeTop={(name) => {
            update(recordFreeTop(records, game, groupId, { name: name || null, featured: name ? matchFeatured(currentPackBanner, name) : null }));
            notify(`${group.freeLabel} ${name || def.topLabel} 기록 (천장·횟수는 그대로)`);
          }}
          onPullsTo={(n) => {
            const out = recordPullsTo(records, game, groupId, n);
            if (out.mode === "added") { update(out.records); notify(`배너 ${n}번째까지 횟수를 맞췄습니다`); }
            else notify(out.mode === "too-far" ? `그 사이에 ${def.topLabel}이 나왔을 횟수입니다. ${def.topLabel}부터 넣어 주세요` : `지금 기록(${status.bannerPulls}번째)보다 큰 숫자를 넣어 주세요`);
          }} />
        <ForecastPanel {game} record={rec} {groupId} bannerEnd={currentPackBanner?.end ?? null} onPlan={setIncomePlan} />


        <!-- 화면 아래 수동 뽑기 버튼은 뺐다(사용자 2026-11-26). PC는 단축키(Ctrl+Alt+1·0·6·Z)로 직접 입력할 수 있다 -->

      {/if}
    </div>
  {/if}

  {#if !collapsed}
    <!-- 화면 이동은 아래 탭 다섯 개로만 한다(새 기능은 탭을 늘리지 않고 이 안에 넣는다, DESIGN.md §8 화면 규칙) -->
    <nav class="tabbar" aria-label="화면">
      {#each TABS as t (t.id)}
        {@const on = t.id === "main" ? view === "main" || view === "top" : view === t.id}
        <button class:on onclick={() => (view = on && t.id !== "main" ? "main" : t.id)} title={t.label} aria-label={t.label}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} /></svg>
          {#if t.id === "review" && pending > 0}<b class="badge">{pending}</b>{/if}
          <span>{t.label}</span>
        </button>
      {/each}
    </nav>
  {/if}
  {#if toast}<div class="toast">{toast}</div>{/if}
</main>

<style>
  main {
    height: 100%; display: flex; flex-direction: column; position: relative; overflow: hidden;
    background: rgba(var(--bg-rgb), var(--bg-alpha));
    border: 1px solid var(--line); border-radius: var(--radius);
  }
  .line { height: 100%; display: flex; align-items: center; gap: 8px; padding: 0 6px 0 0; white-space: nowrap; cursor: move; }
  .stripe { align-self: stretch; width: 4px; background: linear-gradient(180deg, var(--a2), var(--top)); }
  .line :global(.ring .center) { display: none; }
  .line :global(circle) { stroke-width: 5; }
  .gname { font-family: var(--title-font); }
  .have { font-family: var(--num-font); font-weight: 700; font-size: 15px; margin-left: auto; }
  .have small { font-size: 10px; color: var(--muted); margin-left: 1px; }
  header { display: flex; align-items: center; gap: 6px; padding: 7px 6px 7px 10px; cursor: move; position: relative; }
  .game-select { font-size: 11px; padding: 0 2px; border: none; background: transparent; color: inherit; cursor: pointer; max-width: 150px; }
  .spacer { flex: 1; align-self: stretch; }
  .small { font-size: 11px; }
  .body { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
  .tabs { display: flex; gap: 2px; padding: 3px; background: rgba(0, 0, 0, 0.3); border-radius: var(--radius); }
  .tabs button { flex: 1; border: none; background: transparent; color: var(--muted); padding: 5px 4px; font-size: 12px; border-radius: calc(var(--radius) * 0.7); }
  .tabs button.active { background: var(--tab-active-bg); color: var(--tab-active-fg); font-weight: 700; }
  .review { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .autolog { display: flex; flex-direction: column; gap: 6px; padding: 10px; font-size: 12px; align-self: stretch; }
  .arow { display: flex; justify-content: space-between; align-items: center; gap: 6px; color: var(--text); }
  .arow.unsure { color: var(--warn); }
  .abtn { display: inline-flex; gap: 4px; flex: none; }
  .abtn button { padding: 2px 8px; font-size: 11px; }
  .lbhist { display: flex; flex-direction: column; gap: 6px; padding: 10px; font-size: 12px; align-self: stretch; }
  .lbhead { display: flex; justify-content: space-between; }
  .lbsmall { font-size: 11px; margin: 0; line-height: 1.45; }
  .lblist { display: flex; flex-direction: column; gap: 2px; max-height: 160px; overflow-y: auto; color: var(--text); }
  .lblist .top { font-weight: 700; color: var(--top); }
  .lbact { display: flex; gap: 6px; }
  .lbact .save { flex: 1; }
  .engine-fail { padding: 3px 10px; font-size: 11px; color: var(--warn, #f5b041); background: rgba(0, 0, 0, 0.35); }
  .update { display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 12px; background: rgba(0, 0, 0, 0.45); border-bottom: 1px solid var(--line, rgba(255, 255, 255, 0.15)); }
  .update span { flex: 1; font-weight: 700; }
  .update .later { opacity: 0.7; }
  .toast {
    position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); background: rgba(0, 0, 0, 0.85); color: #fff;
    padding: 5px 12px; border-radius: 999px; font-size: 12px; white-space: nowrap;
  }
  main.collapsed .toast { display: none; }
  .tabbar { display: grid; grid-template-columns: repeat(5, 1fr); border-top: 1px solid var(--line); background: rgba(0, 0, 0, 0.22); padding-bottom: env(safe-area-inset-bottom); }
  .tabbar button { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0 6px; border: 0; border-radius: 0; background: none; color: var(--muted); font-size: 10px; }
  .tabbar svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .tabbar button.on { color: var(--text); font-weight: 700; }
  .tabbar button.on::before { content: ""; position: absolute; top: 0; left: 30%; right: 30%; height: 2px; background: var(--top); border-radius: 2px; }
  .tabbar .badge { position: absolute; top: 2px; left: calc(50% + 6px); min-width: 15px; padding: 0 3px; border-radius: 8px; background: var(--warn, #f5b041); color: #1a1408; font-size: 9px; line-height: 15px; text-align: center; font-weight: 800; }
  .toast { bottom: 64px; }

  /* ---- phone / browser web app ---- */
  main.web {
    width: 100%; max-width: 560px; margin: 0 auto; height: 100dvh;
    border-radius: 0; border-top: none; border-bottom: none;
    padding-top: env(safe-area-inset-top);
  }
  main.web header { cursor: default; padding: 10px 10px 8px 14px; }
  main.web .body { padding: 10px 14px 0; gap: 12px; }
  .games { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 6px 10px; background: rgba(0, 0, 0, 0.18); }
  .games button {
    display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 5px 2px;
    border: 1px solid transparent; background: transparent; color: inherit; font-size: 11px; opacity: 0.65;
  }
  .games button.active { opacity: 1; border-color: var(--line); background: var(--panel); font-weight: 700; }
  .games img { width: 24px; height: 24px; object-fit: contain; }
  main.web :global(input), main.web :global(select) { font-size: 16px; } /* no zoom-on-focus */
  .launch { font-size: 12px; font-weight: 700; white-space: nowrap; }

  /* ---- Android floating window: the native frame adds its own handle ---- */
  main.overlay { height: 100vh; padding-top: 0; }
  main.overlay header { padding: 6px 8px 4px 10px; }
  main.overlay .brand-title { font-size: 14px; }
  main.overlay .games { padding: 3px 6px; }
  main.overlay .games img { width: 18px; height: 18px; }
  main.overlay .games span { font-size: 10px; }
  main.overlay .body { padding: 8px 10px 0; gap: 8px; }
  main.overlay :global(input), main.overlay :global(select) { font-size: 13px; }
</style>
