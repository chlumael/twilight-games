<script lang="ts">
  import { onMount } from "svelte";
  import CurrencyBar from "./components/CurrencyBar.svelte";
  import GroupPanel from "./components/GroupPanel.svelte";
  import PityRing from "./components/PityRing.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import TopForm from "./components/TopForm.svelte";
  import * as api from "./lib/api";
  import { GAMES, GAME_IDS, findGroup } from "./lib/games";
  import {
    availablePulls, convertiblePulls, emptyRecords, groupStatus, lastSessionSize, markTopInLastSession,
    normalizeRecords, recentPulls, recordSession, setCurrency, spendPreview, topHistory, undo, type TopInfo,
  } from "./lib/ledger";
  import { SKINS, skinStyle } from "./lib/themes";
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
  let collapsed = $state(true);
  let view = $state<"main" | "settings" | "review" | "top">("main");
  let clickThrough = $state(false);
  let toast = $state<string | null>(null);

  const def = $derived(GAMES[game]);
  const skin = $derived(SKINS[game]);
  const rec = $derived(records.games[game]);
  const groupId = $derived(settings.activeGroup[game] ?? def.groups[0].id);
  const group = $derived(findGroup(game, groupId));
  const status = $derived(groupStatus(rec, game, groupId));
  const canPull = $derived(availablePulls(rec.currency, group.spend));
  const extraPulls = $derived(convertiblePulls(rec.currency, def.currencies, group.spend));
  const pending = $derived(GAME_IDS.reduce((n, id) => n + records.games[id].pulls.filter((p) => p.status === "pending").length, 0));
  const recent = $derived(recentPulls(rec, groupId, 40));
  const hits = $derived(topHistory(rec, groupId));
  const cost1 = $derived(spendPreview(rec.currency, group.spend, 1));
  const cost10 = $derived(spendPreview(rec.currency, group.spend, 10));

  function notify(msg: string) {
    toast = msg;
    setTimeout(() => (toast === msg ? (toast = null) : null), 2500);
  }

  function update(next: Records) {
    records = next;
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
    const size = collapsed ? COLLAPSED : EXPANDED;
    api.resizeWindow(size.w, size.h);
  });

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

  onMount(() => {
    const unlisten: Promise<() => void>[] = [];
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
    return () => unlisten.forEach((p) => p.then((f) => f()));
  });
</script>

<main class:collapsed data-skin={game} style={skinStyle(game)}>
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
          <select class="game-select" value={manualGame ? game : "auto"} onchange={(e) => selectGame((e.currentTarget as HTMLSelectElement).value)}>
            <option value="auto">{def.name} (자동)</option>
            {#each GAME_IDS as id}<option value={id}>{GAMES[id].name}</option>{/each}
          </select>
        </span>
      </div>
      <span class="spacer" data-tauri-drag-region></span>
      {#if clickThrough}<span class="muted small">통과</span>{/if}
      <button class="icon pend" class:has={pending > 0} onclick={() => (view = view === "review" ? "main" : "review")} title="확인 대기">
        확인 {pending}
      </button>
      <button class="icon" onclick={() => (view = view === "settings" ? "main" : "settings")} aria-label="설정">⚙</button>
      <button class="icon" onclick={() => { collapsed = true; view = "main"; }} aria-label="접기">▴</button>
    </header>

    <div class="body" bind:this={bodyEl}>
      {#if view === "settings"}
        <SettingsPanel
          {settings} {game} record={rec}
          onSettings={changeSettings} onBaseline={setBaseline}
          onExport={exportData} onImport={importData} onClose={() => (view = "main")}
        />
      {:else if view === "review"}
        <section class="review">
          <strong>확인 대기</strong>
          {#if pending === 0}
            <p class="muted">확인할 기록이 없습니다. 화면 인식이 추가되면 여기에 쌓입니다.</p>
          {/if}
          <button onclick={() => (view = "main")}>닫기</button>
        </section>
      {:else}
        <CurrencyBar {game} currencies={def.currencies} values={rec.currency} {canPull} extra={extraPulls} onEdit={editCurrency} />

        {#if def.groups.length > 1}
        <nav class="tabs">
          {#each def.groups as g (g.id)}
            <button class:active={g.id === groupId} onclick={() => selectGroup(g.id)}>{g.name}</button>
          {/each}
        </nav>
        {/if}

        <GroupPanel {status} topLabel={def.topLabel} {recent} {hits} gauge={skin.gauge} onBanner={setBanner} />


        {#if view === "top"}
          <TopForm
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
</style>
