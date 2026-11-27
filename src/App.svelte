<script lang="ts">
  // 화면 틀: 머리줄·게임 줄·아래 탭과 각 화면을 잇는다 (정리 2026-11-27).
  // 상태는 lib/store.svelte.ts(app), 하는 일은 lib/flows/*에 있다. 여기에는 화면 하나에만 쓰는 상태만 둔다.
  import { onMount } from "svelte";
  import { latestRelease, pcUpdateKind } from "./lib/version";
  import CurrencyBar from "./components/CurrencyBar.svelte";
  import GroupPanel from "./components/GroupPanel.svelte";
  import PityRing from "./components/PityRing.svelte";
  import ScreenPanel from "./components/ScreenPanel.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import StatsPanel from "./components/StatsPanel.svelte";
  import CalendarPanel from "./components/CalendarPanel.svelte";
  import FriendsPanel from "./components/FriendsPanel.svelte";
  import ShareSettings from "./components/ShareSettings.svelte";
  import ReviewPanel from "./components/ReviewPanel.svelte";
  import PromptBar from "./components/PromptBar.svelte";
  import ForecastPanel from "./components/ForecastPanel.svelte";
  import { PROFILES } from "./lib/screen-profile";
  import type { RegionFrame } from "./lib/engine";
  import type { ScreenFrame } from "./lib/recognize";
  import { dropPrompt, pushPrompt, type Prompt } from "./lib/prompts";
  import * as api from "./lib/api";
  import { GAMES, findGroup } from "./lib/games";
  import { availablePulls, pullsFrom, groupStatus, recentPulls, topHistory, removeBatches, removeExchange, resetGroup, setCurrency } from "./lib/ledger";
  import { SKINS, skinStyle } from "./lib/themes";
  import * as sync from "./lib/sync";
  import { bannerLabel, bannerPool, groupBanners, itemName, matchFeatured } from "./lib/banners";
  import { gameIcon } from "./lib/icons";
  import { gameByTitle, pickDetectedGame, type Settings } from "./lib/settings";
  import type { GameId } from "./lib/types";
  import { app } from "./lib/store.svelte";
  import { ScreenFlow, genshinItems, sixStars } from "./lib/flows/screen.svelte";
  import { AccountFlow } from "./lib/flows/account.svelte";
  import { loadStored, refreshImages, refreshPack, reloadStored, useDataEffects } from "./lib/flows/data.svelte";
  import * as act from "./lib/flows/records";

  const COLLAPSED = { w: 360, h: 44 };
  const EXPANDED = { w: 360, h: 620 };
  /** 휴대폰·브라우저 웹앱 (PC 오버레이가 아님) */
  const web = !api.inTauri;
  const overlay = api.androidMode === "overlay";
  /** 모든 게임을 한꺼번에 보는 화면: 위쪽 게임 줄을 숨긴다(사용자 2026-11-27) */
  const WHOLE_VIEWS: string[] = ["calendar", "stats", "friends"];
  /** 아래 탭 (선 아이콘: 24칸 기준 경로) */
  const TABS = [
    { id: "main", label: "홈", icon: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" },
    { id: "calendar", label: "달력", icon: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" },
    { id: "stats", label: "내 통계", icon: "M5 20V11M12 20V5M19 20v-6" },
    { id: "friends", label: "친구", icon: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.5-3.5 3.2-6 6.5-6s6 2.5 6.5 6M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.4c1.7.9 2.8 2.9 3 5.6" },
    { id: "settings", label: "설정", icon: "M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" },
  ] as const;

  // ── 화면 상태 ──
  let collapsed = $state(!web);
  let view = $state<"main" | "settings" | "review" | "top" | "stats" | "calendar" | "friends">("main");
  let manualGame = $state(false);
  let detection = $state<api.Detection>({ running: [], foreground: null });
  let clickThrough = $state(false);
  let newVersion = $state<string | null>(null); // PC판: 켤 때 찾은 새 버전
  let updating = $state(false);
  let updateError = $state<string | null>(null);
  async function runUpdate() {
    updating = true; updateError = null;
    try { await api.installPcUpdate(); } // 성공하면 프로그램이 꺼지고 설치가 시작된다
    catch (e) { updateError = String(e instanceof Error ? e.message : e); updating = false; }
  }

  // ── 확인 창 (Ctrl+Alt+Y 예 / Ctrl+Alt+N 아니요) ──
  let prompts = $state.raw<Prompt[]>([]);
  function ask(p: Omit<Prompt, "id">) {
    prompts = pushPrompt(prompts, { ...p, id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
    collapsed = false;
  }
  function answerPrompt(yes: boolean) {
    const p = prompts[0];
    if (!p) return;
    prompts = dropPrompt(prompts, p.id);
    if (p.action.type === "genshin-reload" && yes) void screen.loadGenshinWishes();
  }

  // ── 하는 일 (lib/flows) ──
  const screen = new ScreenFlow(() => {
    if (!api.inTauri) return;
    ask({ text: "5성이 나왔습니다. 원신 기원 기록을 새로 불러올까요?", yes: "불러오기", no: "나중에", action: { type: "genshin-reload" } });
  });
  const acct = new AccountFlow();
  acct.autoPush();
  useDataEffects();

  // ── 지금 보고 있는 게임·종류 ──
  const records = $derived(app.records);
  const settings = $derived(app.settings);
  const pack = $derived(app.pack);
  const game = $derived(app.game);
  const myGames = $derived(app.myGames);
  const def = $derived(GAMES[game]);
  /** 화면 테마: 설정에서 고정했으면 그 게임 테마, 아니면 홈에서 고른 게임 (사용자 2026-11-27) */
  const look = $derived<GameId>(settings.theme && settings.theme !== "game" ? settings.theme : game);
  const skin = $derived(SKINS[look]);
  const rec = $derived(records.games[game]);
  const groupId = $derived(app.activeGroup(game));
  const group = $derived(findGroup(game, groupId));
  const status = $derived(groupStatus(rec, game, groupId));
  const canPull = $derived(availablePulls(rec.currency, group.spend));
  const included = $derived(
    // 직접 입력 재화와, 바꿔서 쓰는 재화(창세의 결정·파생 오리지늄·오리지늄)가 몇 회분인지 따로 보여 준다
    def.currencies.filter((c) => c.manualOnly || group.spend.some((st) => st.topUp?.key === c.key))
      .map((c) => ({ label: c.label, pulls: pullsFrom(rec.currency, group.spend, c.key) })),
  );
  const pending = $derived(screen.pending);
  const recent = $derived(recentPulls(rec, groupId, 40));
  const hits = $derived(topHistory(rec, groupId));
  const banners = $derived(groupBanners(pack, game, groupId));
  const currentPackBanner = $derived(banners.find((b) => b.id === status.banner));
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
  const bannerName = (g: GameId, id: string) => { const b = (pack?.games[g] ?? []).find((x) => x.id === id); return b ? `${bannerLabel(b)} · ${b.name}` : id; };

  function changeSettings(next: Settings) {
    app.setSettings(next);
    if (!app.myGames.includes(game) && view === "top") view = "main";
  }
  function switchGame(id: GameId) {
    app.setGame(id);
    // 확인·통계·설정 화면은 게임을 바꿔도 그대로 둔다. 최고 등급 입력 창만 그 게임 것이라 닫는다.
    if (view === "top") view = "main";
  }
  function selectGame(value: string) {
    manualGame = value !== "auto";
    app.setGame(manualGame ? (value as GameId) : pickDetectedGame(detection.running, detection.foreground, game));
  }
  const selectGroup = (id: string) => (app.settings = { ...settings, activeGroup: { ...settings.activeGroup, [game]: id } });

  // ── 화면 효과 ──
  $effect(() => { document.documentElement.style.setProperty("--bg-alpha", String(settings.opacity)); });
  $effect(() => { if (app.loaded) api.setProcessMap(settings.processNames); });
  $effect(() => { if (app.loaded) api.setShareVisible(!!settings.shareVisible); });
  $effect(() => {
    if (web) return;
    const size = collapsed ? COLLAPSED : EXPANDED;
    api.resizeWindow(size.w, size.h);
  });
  let bodyEl = $state<HTMLDivElement>();
  $effect(() => {
    game; groupId;
    bodyEl?.scrollTo({ top: 0 });
  });
  // 안드로이드 게임 위 창: 접힌 막대(천장·확정·가능 횟수)를 앱 쪽에 알려 준다
  $effect(() => {
    if (api.androidMode !== "overlay" || !api.android?.updateSummary) return;
    const v = skin.vars;
    const hex = (rgb: string) => "#" + rgb.split(",").map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    api.android.updateSummary(JSON.stringify({
      game: def.shortName, group: group.name, pity: status.pity, hard: status.hardPity, guaranteed: status.guaranteed === true, canPull,
      bg: hex(v["--bg-rgb"]), text: v["--text"], accent: v["--a2"], top: v["--top"],
    }));
  });

  onMount(() => {
    // 화면 읽기 결과 받기 (안드로이드 오버레이). 창이 접혀 있어도 계속 받는다.
    const sw = window as unknown as { __twilightScreen?: (j: string) => void; __twilightScreenState?: (j: string) => void; __twilightReload?: () => void };
    sw.__twilightScreen = screen.onScreenText;
    sw.__twilightScreenState = screen.onScreenState;
    sw.__twilightReload = () => { if (app.loaded) void reloadStored(); };
    const onVisible = async () => {
      if (document.visibilityState !== "visible" || !app.loaded) return;
      await reloadStored();
      if (acct.account) void acct.syncNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    const unlisten: Promise<() => void>[] = [];
    let unwatch = () => {};
    (async () => {
      await loadStored();
      unwatch = acct.watch();
      await refreshPack();
      void refreshImages();
    })();
    unlisten.push(api.onEvent<api.Detection>("game-detected", (d) => {
      detection = d;
      // 실행 파일 이름으로 못 잡아도 창 이름이 게임 이름이면 그 게임으로(사용자 PC 실기 2026-11-27)
      const fg = d.foreground ?? gameByTitle(d.foregroundTitle);
      if (!manualGame && (fg || d.running.length)) app.game = pickDetectedGame(d.running, fg, app.game);
    }));
    unlisten.push(api.onEvent<boolean>("click-through", (on) => (clickThrough = on)));
    // PC판: 같은 처리기를 Tauri 이벤트에 연결하고, 켤 때 화면 읽기를 함께 시작한다
    if (api.inTauri) {
      unlisten.push(api.onEvent<ScreenFrame>("screen-text", (f) => screen.onScreenText(JSON.stringify(f))));
      unlisten.push(api.onEvent<{ state: string; message: string }>("screen-state", (st) => screen.onScreenState(JSON.stringify(st))));
      unlisten.push(api.onEvent<RegionFrame>("screen-regions", screen.onRegions));
      api.setScreenProfiles(PROFILES);
      api.screenRead(true);
      // 켤 때 새 버전을 확인하고, 있으면 창을 펼쳐 알린다
      void api.pcVersion().then(async (cur) => {
        const r = cur ? await latestRelease() : null;
        const kind = pcUpdateKind(r, cur, __BUILD_TIME__);
        // 같은 버전 번호라도 고친 설치 파일이 새로 올라왔으면 알린다(사용자 2026-11-27)
        if (kind === "new") { newVersion = `새 버전 ${r!.version}이 있습니다`; collapsed = false; }
        else if (kind === "fix") { newVersion = "고친 내용이 새로 올라왔습니다"; collapsed = false; }
      });
    }
    unlisten.push(api.onEvent<string>("hotkey", (action) => {
      if (action === "toggle-collapse") collapsed = !collapsed;
      else if (action === "open-review") { collapsed = false; view = "review"; }
      else if (action === "undo") app.undo();
      else if (action === "pull-1") act.pull(1);
      else if (action === "pull-10") act.pull(10);
      else if (action === "top") act.hotkeyTop();
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

<main class:collapsed class:web class:overlay data-skin={look} style={skinStyle(look)}>
  {#if collapsed}
    <div class="line" data-tauri-drag-region ondblclick={() => (collapsed = false)} role="presentation">
      <span class="stripe" data-tauri-drag-region></span>
      <PityRing value={status.pity} max={status.hardPity} soft={status.softFrom} label="" size={30} />
      <strong class="gname" data-tauri-drag-region>{def.shortName}</strong>
      <span class="muted" data-tauri-drag-region>{group.name}</span>
      {#if status.guaranteed}<span class="good" data-tauri-drag-region>확정</span>{/if}
      <span class="have" data-tauri-drag-region>{canPull}<small>뽑</small></span>
      {#if pending}<span class="warn" data-tauri-drag-region>확인 {pending}</span>{/if}
      {#if screen.engineFailing}<span class="warn small" data-tauri-drag-region title={screen.engineStatus.message}>인식 못 함</span>{/if}
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
          <span>{updateError ?? newVersion}</span>
          <button onclick={runUpdate}>{updateError ? "다시 시도" : "업데이트"}</button>
          {#if updateError}<button onclick={() => api.openPcDownload()}>직접 받기</button>{/if}
          <button class="later" onclick={() => (newVersion = null)}>나중에</button>
        {/if}
      </div>
    {/if}
    {#if prompts.length}<PromptBar prompt={prompts[0]} pc={api.inTauri} onAnswer={answerPrompt} />{/if}
    {#if screen.engineFailing}<div class="engine-fail" title={screen.engineStatus.message}>{screen.engineStatus.message}</div>{/if}
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
              {#each myGames as id}<option value={id}>{GAMES[id].name}</option>{/each}
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
    {#if web && !WHOLE_VIEWS.includes(view)}
      <nav class="games" aria-label="게임 선택" style:grid-template-columns="repeat({myGames.length}, 1fr)">
        {#each myGames as id (id)}
          {@const ic = gameIcon(id)}
          <button class:active={id === game} onclick={() => switchGame(id)}>
            {#if ic}<img src={ic} alt="" />{/if}<span>{GAMES[id].shortName}</span>
          </button>
        {/each}
      </nav>
    {/if}

    <div class="body" bind:this={bodyEl}>
      {#if view === "settings"}
        <SettingsPanel
          {settings} {game} {web} record={rec} foregroundApp={detection.foregroundExe ? `${detection.foregroundExe}${detection.foregroundTitle ? ` (창 이름: ${detection.foregroundTitle})` : ""}` : ""}
          onSettings={changeSettings} onBaseline={act.setBaseline}
          onExport={act.exportData} onImport={act.importData} onClose={() => (view = "main")}
          syncConfigured={sync.syncConfigured} account={acct.account} syncState={acct.syncState} lastSync={acct.lastSync}
          onSignIn={acct.signIn} onSignOut={acct.signOut} onSync={acct.syncNow} onDeleteAccount={acct.deleteAll}
          shareSection={shareSettingsSnippet}
          onGenshinWishes={api.inTauri ? screen.loadGenshinWishes : undefined} genshinWishBusy={screen.wishBusy} genshinWishMsg={screen.wishMsg}
        />
        <!-- 화면 읽기 상태·읽은 재화 (예전 "확인" 탭에 있던 것) -->
        <ScreenPanel {game} currency={rec.currency} reading={screen.screenOn} message={screen.screenMessage} frame={screen.screenFrame} result={screen.screenResult} region={screen.lastRegion}
          onCurrency={(values) => app.update(setCurrency(records, game, values))} />
      {:else if view === "calendar"}
        <CalendarPanel {pack} {game} gameList={myGames} mine={settings.calendar ?? []} onClose={() => (view = "main")}
          onMine={(list) => {
            const gone = (settings.calendar ?? []).filter((m) => !list.some((x) => x.id === m.id)).map((m) => m.id);
            changeSettings({ ...settings, calendar: list, calendarRemoved: [...new Set([...(settings.calendarRemoved ?? []), ...gone])].slice(-500) });
            if (acct.account) setTimeout(() => void acct.syncNow(), 800);
          }} />
      {:else if view === "friends"}
        {#if acct.account}
          <FriendsPanel me={acct.account.uid} games={myGames} sharing={acct.share.on} nickname={acct.share.nickname} busy={acct.shareBusy}
            onJoin={acct.join} load={acct.loadShares} />
        {:else}
          <section class="review">
            <strong>친구</strong>
            <p class="muted">설정에서 구글 로그인을 하면, 공유한 사람들의 전체 통계와 운 순위를 볼 수 있습니다.</p>
            <button onclick={() => (view = "settings")}>설정으로</button>
          </section>
        {/if}
      {:else if view === "stats"}
        <StatsPanel {records} games={myGames} {game}
          {bannerName}
          onReset={(g, gid) => { app.update(resetGroup(records, g, gid)); app.lastApply = `${findGroup(g, gid).name} 기록 전부 지우기`; app.notify(`${findGroup(g, gid).name} 기록을 지웠습니다. 뽑기는 "확인할 것"에서 되돌릴 수 있습니다`); }}
          onRemove={(g, keys, label) => { app.update(removeBatches(records, g, keys, label)); app.lastApply = label; app.notify(`${label} — "확인할 것"에서 되돌릴 수 있습니다`); }} />
      {:else if view === "review"}
        <ReviewPanel flow={screen} onClose={() => (view = "main")} />
      {:else}
        {#if pending > 0}
          <!-- 확인할 것이 있을 때만 보이는 줄 (예전 "확인" 탭 대신, 사용자 2026-11-27) -->
          <button class="pendbar" onclick={() => (view = "review")}>확인할 것 {pending}개 <span>보기 ›</span></button>
        {/if}
        <CurrencyBar {game} currencies={def.currencies} values={rec.currency} {canPull} {included} onEdit={act.editCurrency} />

        {#if def.groups.length > 1}
        <nav class="tabs">
          {#each def.groups as g (g.id)}
            <button class:active={g.id === groupId} onclick={() => selectGroup(g.id)}>{g.name}</button>
          {/each}
        </nav>
        {/if}

        <GroupPanel {game} {status} groupLabel={group.name} topLabel={def.topLabel} {recent} {hits} gauge={SKINS[game].gauge} {banners} onBanner={act.setBanner}
          {topNames} guessFeatured={(n) => matchFeatured(currentPackBanner, n)} onTopAt={act.saveTopAt}
          onEditTop={act.editTopRecord} onRemoveTop={act.removeTopRecord}
          chooseOptions={group.featuredRule === "fate-point" ? (currentPackBanner?.featured ?? []).map(itemName) : []}
          chosen={rec.chosen?.[groupId]?.banner === status.banner ? rec.chosen[groupId].name : ""} onChoose={act.setChosen}
          exchanges={(rec.exchanges ?? []).filter((e) => e.group === groupId && e.banner === status.banner)}
          onExchange={act.exchange}
          onRemoveExchange={(id) => app.update(removeExchange(records, game, id))}
          poolOf={(b) => (rotationRules[b.group] || b.pool?.length ? bannerPool(pack?.games[game] ?? [], b, rotationRules) : null)}
          freeLabel={group.freeLabel ?? ""}
          share={group.featuredShare ?? 0.5}
          onFreeTop={act.freeTop} onPullsTo={act.pullsTo} />
        <ForecastPanel {game} record={rec} {groupId} bannerEnd={currentPackBanner?.end ?? null} onPlan={act.setIncomePlan} />


        <!-- 화면 아래 수동 뽑기 버튼은 뺐다(사용자 2026-11-26). PC는 단축키(Ctrl+Alt+1·0·6·Z)로 직접 입력할 수 있다 -->

      {/if}
    </div>
  {/if}

  {#if !collapsed}
    <!-- 화면 이동은 아래 탭 다섯 개로만 한다(새 기능은 탭을 늘리지 않고 이 안에 넣는다, DESIGN.md §8 화면 규칙) -->
    <nav class="tabbar" aria-label="화면">
      {#each TABS as t (t.id)}
        {@const on = t.id === "main" ? view === "main" || view === "top" || view === "review" : view === t.id}
        <button class:on onclick={() => (view = on && t.id !== "main" ? "main" : t.id)} title={t.label} aria-label={t.label}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} /></svg>
          {#if t.id === "main" && pending > 0}<b class="badge">{pending}</b>{/if}
          <span>{t.label}</span>
        </button>
      {/each}
    </nav>
  {/if}
  {#if app.toast}<div class="toast">{app.toast}</div>{/if}
</main>

{#snippet shareSettingsSnippet()}
  <ShareSettings share={acct.share} busy={acct.shareBusy} onNickname={acct.setNickname} onToggle={acct.toggleShare} />
{/snippet}

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
  .engine-fail { padding: 3px 10px; font-size: 11px; color: var(--warn, #f5b041); background: rgba(0, 0, 0, 0.35); }
  .update { display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 12px; background: rgba(0, 0, 0, 0.45); border-bottom: 1px solid var(--line, rgba(255, 255, 255, 0.15)); }
  .update span { flex: 1; font-weight: 700; }
  .update .later { opacity: 0.7; }
  .toast {
    position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); background: rgba(0, 0, 0, 0.85); color: #fff;
    padding: 5px 12px; border-radius: 999px; font-size: 12px; white-space: nowrap;
  }
  main.collapsed .toast { display: none; }
  .pendbar { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 8px 12px; font-size: 13px; font-weight: 700; color: #1a1408; background: var(--warn, #f5b041); border: 0; border-radius: var(--radius); }
  .pendbar span { font-weight: 600; }
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
  .games img { width: 28px; height: 28px; border-radius: 7px; object-fit: contain; }
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
