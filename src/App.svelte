<script lang="ts">
  import { onMount } from "svelte";
  import CurrencyBar from "./components/CurrencyBar.svelte";
  import GroupPanel from "./components/GroupPanel.svelte";
  import PityRing from "./components/PityRing.svelte";
  import ScreenPanel from "./components/ScreenPanel.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import StatsPanel from "./components/StatsPanel.svelte";
  import TopForm from "./components/TopForm.svelte";
  import * as api from "./lib/api";
  import { GAMES, GAME_IDS, findGroup } from "./lib/games";
  import {
    availablePulls, emptyRecords, pullsFrom, groupStatus, lastSessionSize, markTopInLastSession,
    normalizeRecords, recentPulls, recordSession, setCurrency, spendPreview, topHistory, undo, type TopInfo,
  } from "./lib/ledger";
  import { SKINS, skinStyle } from "./lib/themes";
  import { gameFingerprint, gamesToPush, mergeRecords, stampChanged } from "./lib/merge";
  import * as sync from "./lib/sync";
  import bundledPack from "../data/banners.json";
  import { autoBanner, bannerLabel, groupBanners, isPack, itemName, matchFeatured, newerPack, PACK_URL, type BannerPack } from "./lib/banners";
  import { currencyIcon } from "./lib/icons";
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
  let view = $state<"main" | "settings" | "review" | "top" | "stats">("main");
  let clickThrough = $state(false);
  let toast = $state<string | null>(null);
  let pack = $state.raw<BannerPack | null>(isPack(bundledPack) ? bundledPack : null);

  const def = $derived(GAMES[game]);
  const skin = $derived(SKINS[game]);
  const rec = $derived(records.games[game]);
  const groupId = $derived(settings.activeGroup[game] ?? def.groups[0].id);
  const group = $derived(findGroup(game, groupId));
  const status = $derived(groupStatus(rec, game, groupId));
  const canPull = $derived(availablePulls(rec.currency, group.spend));
  const included = $derived(
    def.currencies.filter((c) => c.manualOnly).map((c) => ({ label: c.label, pulls: pullsFrom(rec.currency, group.spend, c.key) })),
  );
  const pending = $derived(GAME_IDS.reduce((n, id) => n + records.games[id].pulls.filter((p) => p.status === "pending").length, 0));
  const recent = $derived(recentPulls(rec, groupId, 40));
  const hits = $derived(topHistory(rec, groupId));
  const cost1 = $derived(spendPreview(rec.currency, group.spend, 1));
  const cost10 = $derived(spendPreview(rec.currency, group.spend, 10));
  const banners = $derived(groupBanners(pack, game, groupId));
  /** 기록에 저장된 배너 ID를 보여 줄 이름으로 바꾼다 (팩에 없으면 그대로). */
  function packBannerName(id: string): string {
    const b = (pack?.games[game] ?? []).find((x) => x.id === id);
    return b ? `${bannerLabel(b)} · ${b.name}` : id;
  }
  const currentPackBanner = $derived(banners.find((b) => b.id === status.banner));
  const suggestions = $derived(currentPackBanner?.featured.map(itemName) ?? []);

  // Follow the banner schedule: switch groups to the running banner unless the user typed one.
  $effect(() => {
    if (!loaded || !pack) return;
    let next: Records | null = null;
    for (const id of GAME_IDS) {
      for (const g of GAMES[id].groups) {
        const cur = (next ?? records).games[id].currentBanner[g.id] ?? "";
        const to = autoBanner(groupBanners(pack, id, g.id), cur);
        if (to) {
          next ??= structuredClone(records);
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
      records = merged;
      const pushed: Record<string, string> = {};
      for (const id of GAME_IDS) if (remote.games[id]) pushed[id] = gameFingerprint(remote.games[id]!);
      await pushPending(a.uid, pushed);
      if (firstLink) await sync.pushSettings(a.uid, settings);
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
    view = "main";
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
    unlisten.push(api.onEvent<string>("hotkey", (action) => {
      if (action === "toggle-collapse") collapsed = !collapsed;
      else if (action === "open-review") { collapsed = false; view = "review"; }
      else if (action === "undo") doUndo();
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
      {#if clickThrough}<span class="muted" data-tauri-drag-region title="클릭 통과 중 (Ctrl+Alt+T)">⇣</span>{/if}
      <button class="icon expand" onclick={() => (collapsed = false)} aria-label="펼치기">▾</button>
    </div>
  {:else}
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
      <button class="icon pend" class:has={pending > 0} onclick={() => (view = view === "review" ? "main" : "review")} title="확인 대기">
        확인 {pending}
      </button>
      <button class="icon" onclick={() => (view = view === "stats" ? "main" : "stats")} title="통계">통계</button>
      <button class="icon" onclick={() => (view = view === "settings" ? "main" : "settings")} aria-label="설정">⚙</button>
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
        />
      {:else if view === "stats"}
        <StatsPanel {game} record={rec} bannerName={packBannerName} onClose={() => (view = "main")} />
      {:else if view === "review"}
        <section class="review">
          <strong>확인 대기</strong>
          {#if pending === 0}
            <p class="muted">확인할 기록이 없습니다.</p>
          {/if}
          <ScreenPanel {game} currency={rec.currency} onGame={(id) => { game = id; settings = { ...settings, lastGame: id }; }}
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

        <GroupPanel {status} groupLabel={group.name} topLabel={def.topLabel} {recent} {hits} gauge={skin.gauge} {banners} onBanner={setBanner} />


        {#if view === "top"}
          <TopForm
            {suggestions}
            guessFeatured={(n) => matchFeatured(currentPackBanner, n)}
            topLabel={def.topLabel}
            lastSessionSize={lastSessionSize(rec, groupId)}
            showFeatured={group.featuredRule !== "none" || group.bannerCounters.length > 0}
            onSubmit={saveTop}
            onCancel={() => (view = "main")}
          />
        {:else}
          <section class="actions">
            {#each [{ n: 1, cost: cost1, label: skin.pull1 }, { n: 10, cost: cost10, label: skin.pull10 }] as b (b.n)}
              <button class="primary pull" onclick={() => pull(b.n)}>
                <span class="plabel">{b.label}</span>
                <span class="pcost">
                  {#each b.cost.items as it (it.key)}
                    {@const ic = currencyIcon(game, it.key)}
                    {#if ic}<img src={ic} alt="" />{:else}<i class="nog" title={def.currencies.find((c) => c.key === it.key)?.label}></i>{/if}<span>{it.amount.toLocaleString()}</span>
                  {/each}
                  {#if b.cost.shortfall}<span class="short">부족 {b.cost.shortfall}</span>{/if}
                </span>
              </button>
            {/each}
            <button class="act-top" onclick={() => (view = "top")}>★ {def.topLabel}</button>
            <button class="undo" onclick={doUndo} title="되돌리기 (Ctrl+Alt+Z)" aria-label="되돌리기">↶</button>
          </section>
        {/if}

      {/if}
    </div>
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
  .pend { white-space: nowrap; font-size: 12px; }
  .pend.has { color: var(--warn); font-weight: 700; }
  .spacer { flex: 1; align-self: stretch; }
  .small { font-size: 11px; }
  .body { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
  .tabs { display: flex; gap: 2px; padding: 3px; background: rgba(0, 0, 0, 0.3); border-radius: var(--radius); }
  .tabs button { flex: 1; border: none; background: transparent; color: var(--muted); padding: 5px 4px; font-size: 12px; border-radius: calc(var(--radius) * 0.7); }
  .tabs button.active { background: var(--tab-active-bg); color: var(--tab-active-fg); font-weight: 700; }
  .actions { display: grid; grid-template-columns: 1fr 1fr 0.9fr 34px; gap: 6px; }
  .actions button { padding: 7px 4px; font-weight: 700; }
  .pull { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .plabel { font-size: 13px; }
  .pcost { display: flex; align-items: center; gap: 2px; font-size: 11px; font-weight: 600; opacity: 0.85; flex-wrap: wrap; justify-content: center; }
  .pcost img { width: 16px; height: 16px; object-fit: contain; }
  .short { color: var(--warn); }
  .nog { width: 8px; height: 8px; margin: 0 3px; transform: rotate(45deg); border: 2px solid currentColor; }
  .actions button.primary { background: var(--btn-bg); color: var(--btn-fg); border: var(--btn-border); clip-path: var(--btn-clip); }
  .undo { color: var(--muted); font-size: 16px; }
  .review { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .toast {
    position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); background: rgba(0, 0, 0, 0.85); color: #fff;
    padding: 5px 12px; border-radius: 999px; font-size: 12px; white-space: nowrap;
  }
  main.collapsed .toast { display: none; }

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
  main.web .actions {
    position: sticky; bottom: 0; z-index: 3; margin: 0 -14px; padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
    background: linear-gradient(180deg, transparent, rgba(var(--bg-rgb), 0.96) 28%);
  }
  main.web .actions button { padding: 11px 4px; }
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
  main.overlay .actions { margin: 0 -10px; padding: 6px 10px 8px; }
  main.overlay .actions button { padding: 7px 3px; }
  main.overlay :global(input), main.overlay :global(select) { font-size: 13px; }
</style>
