<script lang="ts">
  import { onMount } from "svelte";
  import GroupPanel from "./components/GroupPanel.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import TopForm from "./components/TopForm.svelte";
  import * as api from "./lib/api";
  import { GAMES, GAME_IDS, findGroup } from "./lib/games";
  import {
    availablePulls, emptyRecords, groupStatus, lastSessionSize, markTopInLastSession,
    normalizeRecords, recordSession, setCurrency, undo, type TopInfo,
  } from "./lib/ledger";
  import { defaultSettings, normalizeSettings, pickDetectedGame, type Settings } from "./lib/settings";
  import type { Baseline, GameId, Records } from "./lib/types";

  const COLLAPSED = { w: 360, h: 44 };
  const EXPANDED = { w: 360, h: 600 };

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
  const rec = $derived(records.games[game]);
  const groupId = $derived(settings.activeGroup[game] ?? def.groups[0].id);
  const group = $derived(findGroup(game, groupId));
  const status = $derived(groupStatus(rec, game, groupId));
  const canPull = $derived(availablePulls(rec.currency, group.spend));
  const pending = $derived(GAME_IDS.reduce((n, id) => n + records.games[id].pulls.filter((p) => p.status === "pending").length, 0));
  const recent = $derived(rec.pulls.filter((p) => p.group === groupId && p.top).slice(-5).reverse());

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

<main class:collapsed>
  {#if collapsed}
    <div class="line" data-tauri-drag-region ondblclick={() => (collapsed = false)} role="presentation">
      <strong data-tauri-drag-region>{def.shortName}</strong>
      <span data-tauri-drag-region>{group.name} {status.pity}{status.hardPity ? `/${status.hardPity}` : ""}</span>
      {#if status.guaranteed}<span class="good" data-tauri-drag-region>확정</span>{/if}
      <span data-tauri-drag-region>보유 {canPull}뽑</span>
      {#if pending}<span class="warn" data-tauri-drag-region>확인 {pending}</span>{/if}
      {#if clickThrough}<span class="muted" data-tauri-drag-region title="클릭 통과 중 (Ctrl+Alt+T)">⇣</span>{/if}
      <button class="icon expand" onclick={() => (collapsed = false)} aria-label="펼치기">▾</button>
    </div>
  {:else}
    <header data-tauri-drag-region>
      <select value={manualGame ? game : "auto"} onchange={(e) => selectGame((e.currentTarget as HTMLSelectElement).value)}>
        <option value="auto">자동: {def.name}</option>
        {#each GAME_IDS as id}<option value={id}>{GAMES[id].name}</option>{/each}
      </select>
      <span class="spacer" data-tauri-drag-region></span>
      {#if clickThrough}<span class="muted small">클릭 통과</span>{/if}
      <button class="icon" onclick={() => (view = view === "review" ? "main" : "review")} title="확인 대기">
        확인 {pending}
      </button>
      <button class="icon" onclick={() => (view = view === "settings" ? "main" : "settings")} aria-label="설정">⚙</button>
      <button class="icon" onclick={() => { collapsed = true; view = "main"; }} aria-label="접기">▴</button>
    </header>

    <div class="body">
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
        <nav class="tabs">
          {#each def.groups as g (g.id)}
            <button class:active={g.id === groupId} onclick={() => selectGroup(g.id)}>{g.name}</button>
          {/each}
        </nav>

        <GroupPanel {status} topLabel={def.topLabel} onBanner={setBanner} />

        <section class="currency">
          <div class="head">
            <span>보유 재화</span>
            <span class="accent">지금 {canPull}뽑 가능</span>
          </div>
          <div class="grid">
            {#each def.currencies as c (c.key)}
              <label>
                {c.label}
                <input type="number" min="0" value={rec.currency[c.key] ?? 0}
                  onchange={(e) => editCurrency(c.key, (e.currentTarget as HTMLInputElement).value)} />
              </label>
            {/each}
          </div>
        </section>

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
            <button class="primary" onclick={() => pull(1)}>+1</button>
            <button class="primary" onclick={() => pull(10)}>+10</button>
            <button class="top-btn" onclick={() => (view = "top")}>★ {def.topLabel}</button>
            <button onclick={doUndo} title="Ctrl+Alt+Z">되돌리기</button>
          </section>
        {/if}

        {#if recent.length}
          <section class="recent">
            <span class="muted">최근 {def.topLabel}</span>
            {#each recent as p (p.id)}
              <div class="row">
                <span class="top">{p.name ?? "이름 미입력"}</span>
                <span class="muted">{p.featured === true ? "픽업" : p.featured === false ? "픽뚫" : ""} · {new Date(p.time).toLocaleDateString("ko-KR")}</span>
              </div>
            {/each}
          </section>
        {/if}
      {/if}
    </div>
  {/if}

  {#if toast}<div class="toast">{toast}</div>{/if}
</main>

<style>
  main {
    height: 100%; display: flex; flex-direction: column; background: var(--bg);
    border: 1px solid var(--line); border-radius: 10px; overflow: hidden; position: relative;
  }
  .line { height: 100%; display: flex; align-items: center; gap: 10px; padding: 0 6px 0 12px; white-space: nowrap; cursor: move; }
  .line .expand { margin-left: auto; }
  header { display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 8px; border-bottom: 1px solid var(--line); cursor: move; }
  header select { max-width: 170px; }
  .spacer { flex: 1; align-self: stretch; }
  .small { font-size: 11px; }
  .body { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 12px; }
  .tabs { display: flex; gap: 4px; flex-wrap: wrap; }
  .tabs button.active { border-color: var(--accent); color: var(--accent); }
  .currency .head { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .accent { color: var(--accent); font-weight: 600; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .grid label { display: flex; flex-direction: column; gap: 2px; }
  .actions { display: grid; grid-template-columns: 1fr 1fr 1.4fr 1.2fr; gap: 6px; }
  .actions button { padding: 8px 4px; }
  .top-btn { color: var(--top); border-color: rgba(255, 211, 107, 0.4); }
  .recent { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
  .recent .row { display: flex; justify-content: space-between; }
  .review { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .toast {
    position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); background: rgba(0, 0, 0, 0.8);
    padding: 4px 10px; border-radius: 6px; font-size: 12px; white-space: nowrap;
  }
  main.collapsed .toast { display: none; }
</style>
