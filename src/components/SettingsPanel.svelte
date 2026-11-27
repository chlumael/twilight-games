<script lang="ts">
  import type { Snippet } from "svelte";
  import { GAMES, GAME_IDS } from "../lib/games";
  import { gameIcon } from "../lib/icons";
  import { emptyBaseline } from "../lib/ledger";
  import { android, androidMode, inTauri, installPcUpdate, listProcesses, openPcDownload, pcVersion } from "../lib/api";
  import { isNewer, latestRelease } from "../lib/version";
  import { profileOf, screenReady } from "../lib/screen-profile";
  import { moveGame, shownGames, type Settings } from "../lib/settings";
  import type { Baseline, GameId, GameRecord } from "../lib/types";

  let {
    settings, game, web = false, record, onSettings, onBaseline, onExport, onImport, onClose,
    syncConfigured = false, account = null, syncState = "idle", lastSync = null, onSignIn, onSignOut, onSync, onDeleteAccount, shareSection,
    onGenshinWishes, genshinWishBusy = false, genshinWishMsg = "",
  }: {
    settings: Settings;
    game: GameId;
    /** Web app: hide desktop-only options (overlay, hotkeys, process detection). */
    web?: boolean;
    record: GameRecord;
    onSettings: (s: Settings) => void;
    onBaseline: (groupId: string, b: Baseline) => void;
    onExport: () => void;
    onImport: () => void;
    onClose: () => void;
    syncConfigured?: boolean;
    account?: { uid: string; email: string | null; name: string | null } | null;
    syncState?: "idle" | "syncing" | "ok" | "error";
    lastSync?: string | null;
    onSignIn?: () => void;
    onSignOut?: () => void;
    onSync?: () => void;
    /** 계정과 서버 기록 삭제 */
    onDeleteAccount?: () => void;
    /** 친구 공유 설정 (로그인했을 때 App이 채운다) */
    shareSection?: Snippet;
    /** PC판 원신 기원 기록 불러오기 */
    onGenshinWishes?: () => void;
    genshinWishBusy?: boolean;
    genshinWishMsg?: string;
  } = $props();

  // 새 화면 인식 틀이 얼마나 채워졌는지 (DESIGN.md §4.8, 빈칸은 docs/recognition-gaps.md)
  const gameScreens = $derived(profileOf(game)?.screens ?? []);
  const readyScreens = $derived(gameScreens.filter(screenReady).length);

  let processes = $state<string[]>([]);

  function setProcesses(id: GameId, text: string) {
    const names = text.split(",").map((s) => s.trim()).filter(Boolean);
    onSettings({ ...settings, processNames: { ...settings.processNames, [id]: names } });
  }

  function addProcess(id: GameId, name: string) {
    if (!name) return;
    const cur = settings.processNames[id];
    if (!cur.includes(name)) setProcesses(id, [...cur, name].join(", "));
  }

  function baseline(groupId: string): Baseline {
    return { ...emptyBaseline(), ...(record.baseline[groupId] ?? {}) };
  }

  function editBaseline(groupId: string, patch: Partial<Baseline>) {
    // 배너 관련 값은 항상 "지금 배너" 기준으로 저장한다(배너 이름을 따로 적게 하면 어긋나서 값이 무시됐다)
    onBaseline(groupId, { ...baseline(groupId), ...patch, banner: record.currentBanner[groupId] ?? "" });
  }
  // PC판 버전 확인: 설정을 열 때 한 번 확인하고, 버튼으로 다시 확인할 수 있다
  let pcVer = $state<string | null>(null);
  let pcUpdate = $state<"" | "checking" | "latest" | "new" | "wait" | "fail">("");
  let pcLatest = $state("");
  let pcInstalling = $state(false);
  let pcInstallError = $state("");
  async function runPcUpdate() {
    pcInstalling = true; pcInstallError = "";
    try { await installPcUpdate(); }
    catch (e) { pcInstallError = String(e instanceof Error ? e.message : e); pcInstalling = false; }
  }
  async function checkPcUpdate() {
    if (!pcVer) return;
    pcUpdate = "checking";
    const r = await latestRelease();
    if (!r) { pcUpdate = "fail"; return; }
    pcLatest = r.version;
    pcUpdate = !isNewer(r.version, pcVer) ? "latest" : r.hasPc ? "new" : "wait";
  }
  if (inTauri) void pcVersion().then((v) => { pcVer = v; void checkPcUpdate(); });

  let confirmDelete = $state(false);
  let showPrivacy = $state(false);
  let autoRead = $state(android?.autoScreenRead?.() ?? true);
</script>

<div class="settings">
  <header>
    <strong>설정</strong>
  </header>

  <section>
    <h4>내 게임</h4>
    <div class="mygames">
      {#each GAME_IDS as id (id)}
        {@const on = shownGames(settings).includes(id)}
        <button class="chip" class:on onclick={() => {
          const cur = shownGames(settings);
          const next = on ? cur.filter((g) => g !== id) : [...cur, id];
          if (next.length) onSettings({ ...settings, myGames: next });
        }} aria-pressed={on}>{#if gameIcon(id)}<img class="gi" src={gameIcon(id)} alt="" />{/if}{GAMES[id].shortName}</button>
      {/each}
    </div>
    {#if shownGames(settings).length > 1}
      <!-- 순서 바꾸기: 위쪽 게임 줄·달력·통계·친구에 이 순서로 보인다(사용자 2026-11-27) -->
      <ol class="order">
        {#each shownGames(settings) as id, i (id)}
          {@const list = shownGames(settings)}
          <li>
            <span class="num">{i + 1}</span>
            {#if gameIcon(id)}<img class="gi" src={gameIcon(id)} alt="" />{/if}
            <span class="oname">{GAMES[id].name}</span>
            <button class="mv" disabled={i === 0} onclick={() => onSettings({ ...settings, myGames: moveGame(list, i, -1) })} aria-label="{GAMES[id].shortName} 위로">▲</button>
            <button class="mv" disabled={i === list.length - 1} onclick={() => onSettings({ ...settings, myGames: moveGame(list, i, 1) })} aria-label="{GAMES[id].shortName} 아래로">▼</button>
          </li>
        {/each}
      </ol>
    {/if}
    <p class="muted hint">고른 게임만 이 순서로 위쪽 줄·달력·통계·친구에 보입니다</p>
  </section>

  <section>
    <h4>테마</h4>
    <div class="mygames">
      {#each [{ id: "game", label: "게임 따라" }, ...GAME_IDS.map((id) => ({ id, label: GAMES[id].shortName }))] as t (t.id)}
        {@const on = (settings.theme ?? "game") === t.id}
        <button class="chip" class:on aria-pressed={on} onclick={() => onSettings({ ...settings, theme: t.id as Settings["theme"] })}>{t.label}</button>
      {/each}
    </div>
    <p class="muted hint">{(settings.theme ?? "game") === "game" ? "홈에서 고른 게임의 테마를 따라갑니다" : "모든 화면에 이 테마를 씁니다"}</p>
  </section>

  {#if !web}
  <section>
    <h4>오버레이</h4>
    <label class="row">
      배경 투명도
      <input
        type="range" min="0.3" max="1" step="0.02" value={settings.opacity}
        oninput={(e) => onSettings({ ...settings, opacity: Number((e.currentTarget as HTMLInputElement).value) })}
      />
    </label>
    <p class="muted hint">단축키 Ctrl+Alt+ T 클릭 통과 · H 접기 · Q 확인 · Z 되돌리기 · 1/0 1회/10회 · 6 최고 등급 · Y/N 예/아니요</p>
    <p class="muted hint">화면 인식 틀 {readyScreens}/{gameScreens.length}</p>
  </section>
  {/if}

  <section>
    <h4>{GAMES[game].name} 시작 상태</h4>
    <p class="muted hint">앱을 쓰기 전 기록. 천장 스택 = 마지막 {GAMES[game].topLabel} 뒤로 뽑은 횟수</p>
    {#each GAMES[game].groups as g (g.id)}
      {@const b = baseline(g.id)}
      <div class="base">
        <span class="gname">{g.name}</span>
        <label>천장 스택 <input type="number" min="0" value={Math.max(0, b.pity)}
          onchange={(e) => editBaseline(g.id, { pity: Number((e.currentTarget as HTMLInputElement).value) || 0 })} /></label>
        {#if g.featuredRule !== "none"}
          <label class="check"><input type="checkbox" checked={b.guaranteed}
            onchange={(e) => editBaseline(g.id, { guaranteed: (e.currentTarget as HTMLInputElement).checked })} />
            {g.featuredRule === "fifty-fifty" ? "다음 확정" : "운명 포인트 1"}</label>
        {/if}
        {#if g.bannerCounters.length}
          <label>지금 배너 누적 <input type="number" min="0" value={b.banner === (record.currentBanner[g.id] ?? "") ? Math.max(0, b.bannerPulls) : 0}
            onchange={(e) => editBaseline(g.id, { bannerPulls: Number((e.currentTarget as HTMLInputElement).value) || 0 })} /></label>
          {#if g.bannerCounters.some((c) => c.untilFeatured)}
            <label class="check"><input type="checkbox" checked={b.bannerFeaturedGot}
              onchange={(e) => editBaseline(g.id, { bannerFeaturedGot: (e.currentTarget as HTMLInputElement).checked })} />
              이 배너 픽업 획득함</label>
          {/if}
        {/if}
      </div>
    {/each}
  </section>

  {#if game === "genshin" && onGenshinWishes}
  <section>
    <h4>원신 기원 기록 불러오기</h4>
    <div class="row">
      <button onclick={onGenshinWishes} disabled={genshinWishBusy}>{genshinWishBusy ? "불러오는 중…" : "기원 기록 불러오기"}</button>
    </div>
    {#if genshinWishMsg}<p class="hint">{genshinWishMsg}</p>{/if}
    <p class="muted hint">게임에서 기원 기록 화면을 한 번 연 뒤 누르기 · 인증 값은 저장하지 않음</p>
  </section>
  {/if}

  {#if !web}
  <section>
    <h4>게임 감지 (실행 파일 이름)</h4>
    <button onclick={async () => (processes = await listProcesses())}>실행 중인 프로그램 불러오기</button>
    {#each GAME_IDS as id (id)}
      <div class="proc">
        <span>{GAMES[id].shortName}</span>
        <input value={settings.processNames[id].join(", ")}
          onchange={(e) => setProcesses(id, (e.currentTarget as HTMLInputElement).value)} />
        {#if processes.length}
          <select onchange={(e) => addProcess(id, (e.currentTarget as HTMLSelectElement).value)}>
            <option value="">추가…</option>
            {#each processes as p}<option value={p}>{p}</option>{/each}
          </select>
        {/if}
      </div>
    {/each}
  </section>

  {/if}

  {#if pcVer}
    <section>
      <h4>프로그램</h4>
      <div class="row">
        <span class="muted">버전 {pcVer}</span>
        <button onclick={checkPcUpdate} disabled={pcUpdate === "checking"}>업데이트 확인</button>
      </div>
      {#if pcUpdate === "new"}
        <div class="row">
          <span>새 버전 {pcLatest}이 있습니다.</span>
          <button onclick={runPcUpdate} disabled={pcInstalling}>{pcInstalling ? "받는 중…" : "업데이트"}</button>
        </div>
        {#if pcInstallError}
          <p class="muted hint">{pcInstallError} <button onclick={() => openPcDownload()}>브라우저로 직접 받기</button></p>
        {:else}
          <p class="muted hint">누르면 새 버전을 받아 설치하고 프로그램이 다시 켜집니다. 기록은 그대로 남습니다.</p>
        {/if}
      {:else if pcUpdate === "latest"}
        <p class="muted hint">최신 버전입니다. 프로그램을 켤 때마다 새 버전을 확인해서 있으면 알려줍니다.</p>
      {:else if pcUpdate === "wait"}
        <p class="muted hint">새 버전 {pcLatest}의 PC 설치 파일을 만드는 중입니다. 10분쯤 뒤에 다시 확인해 주세요.</p>
      {:else if pcUpdate === "checking"}
        <p class="muted hint">확인하는 중…</p>
      {:else if pcUpdate === "fail"}
        <p class="muted hint">새 버전을 확인하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.</p>
      {/if}
    </section>
  {/if}

  {#if androidMode === "app" && android?.appVersion}
    <section>
      <h4>앱</h4>
      <div class="row">
        <span class="muted">버전 {android.appVersion()}</span>
        <button onclick={() => android?.checkUpdate?.()}>업데이트 확인</button>
      </div>
      {#if android?.setAutoScreenRead}
        <label class="autoread">
          <input type="checkbox" checked={autoRead} onchange={(e) => { autoRead = (e.currentTarget as HTMLInputElement).checked; android?.setAutoScreenRead?.(autoRead); }} />
          창을 띄울 때 화면 읽기도 함께 시작
        </label>
      {/if}
    </section>
  {/if}

  {#if syncConfigured}
    <section>
      <h4>트래커 계정</h4>
      {#if account}
        <div class="row">
          <span>{account.name ?? account.email}</span>
          <span class="muted small">{syncState === "syncing" ? "동기화 중…" : syncState === "error" ? "동기화 오류" : lastSync ? `저장됨 ${new Date(lastSync).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
        </div>
        <div class="row">
          <button onclick={onSync}>지금 동기화</button>
          <button onclick={onSignOut}>로그아웃</button>
        </div>
        {#if onDeleteAccount}
          <button class="danger" onclick={() => { if (confirmDelete) { onDeleteAccount(); confirmDelete = false; } else confirmDelete = true; }}>
            {confirmDelete ? "한 번 더 누르면 계정과 서버 기록을 지웁니다" : "계정 삭제"}
          </button>
          {#if confirmDelete}<p class="muted hint">이 기기의 기록은 남습니다(필요하면 먼저 내보내기)</p>{/if}
        {/if}
      {:else if androidMode === "overlay"}
        <p class="muted hint">로그인은 앱 화면의 설정에서</p>
      {:else}
        <button onclick={onSignIn}>구글 계정으로 로그인</button>
        <p class="muted hint">로그인하면 기기를 바꿔도 기록이 남습니다</p>
      {/if}
    </section>
  {/if}

  {#if account && shareSection}
    <section>
      <h4>친구 공유</h4>
      {@render shareSection()}
    </section>
  {/if}

  <section>
    <h4>백업</h4>
    <div class="row">
      <button onclick={onExport}>내보내기</button>
      <button onclick={onImport}>가져오기</button>
    </div>
    <p class="muted hint">
      {account ? "이 기기 + 계정에 저장" : androidMode ? "이 휴대폰에만 저장 · 앱을 지우면 사라짐" : web ? "이 브라우저에만 저장 · 브라우저 데이터를 지우면 사라짐" : "이 PC에만 저장 · 매일 자동 백업(7일)"}
    </p>
  </section>

  <section>
    <button class="linkish" onclick={() => (showPrivacy = !showPrivacy)} aria-expanded={showPrivacy}>개인정보 처리 방침 {showPrivacy ? "▲" : "▼"}</button>
    <!-- 앱 안에서 그대로 보이게(휴대폰 앱은 바깥 링크로 나가지 않는다) -->
    {#if showPrivacy}<iframe class="privacy" src="./privacy.html" title="개인정보 처리 방침"></iframe>{/if}
    <!-- 게임 이미지 출처 (사용자 허용 2026-11-27, 비상업 팬 도구) -->
    <p class="credit">게임 이미지 © HoYoverse · Hypergryph/Yostar · Gryphline · Project Moon. 모은 곳: 각 게임 공식 공지·홈페이지, paimon.moe, ArknightsGameResource, MaaEnd·Endaxis, LocalizeLimbusCompany·eldritchtools. 비상업 팬 도구이며 요청이 있으면 바로 뺍니다.</p>
  </section>
</div>

<style>
  .credit { font-size: 10px; color: var(--muted); line-height: 1.5; margin: 8px 0 0; }
  .settings { display: flex; flex-direction: column; gap: 10px; }
  header { display: flex; justify-content: space-between; align-items: center; }
  h4 { margin: 0 0 4px; font-size: 12px; color: var(--accent); }
  section { display: flex; flex-direction: column; gap: 5px; }
  .row { display: flex; gap: 6px; align-items: center; }
  .hint { margin: 0; font-size: 11px; }
  .linkish { align-self: flex-start; font-size: 12px; background: none; border: 0; color: var(--muted); padding: 2px 0; text-decoration: underline; text-underline-offset: 3px; }
  .privacy { width: 100%; height: 60vh; border: 1px solid var(--line); border-radius: var(--radius); background: #fff; }
  .danger { color: #ff8a7a; font-size: 12px; align-self: flex-start; }
  .mygames { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-size: 12px; padding: 4px 12px; border-radius: 999px; opacity: 0.5; display: inline-flex; align-items: center; gap: 5px; }
  .chip .gi { width: 18px; height: 18px; border-radius: 5px; margin-left: -6px; }
  .order { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .order li { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: var(--btn-radius); background: var(--panel); }
  .order .num { width: 1.2em; text-align: center; color: var(--muted); font-size: 12px; }
  .order .gi { width: 24px; height: 24px; border-radius: 6px; }
  .order .oname { flex: 1; font-size: 13px; }
  .order .mv { padding: 4px 10px; font-size: 12px; }
  .chip.on { opacity: 1; font-weight: 700; border-color: var(--top); }
  .small { font-size: 11px; }
  .base { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; padding: 6px; background: var(--panel); border-radius: 6px; }
  .base .gname { grid-column: 1 / -1; font-weight: 600; }
  .base label { display: flex; flex-direction: column; gap: 2px; }
  .base label.check { flex-direction: row; align-items: center; gap: 4px; }
  .proc { display: grid; grid-template-columns: 56px 1fr auto; gap: 4px; align-items: center; }
  .proc select { max-width: 90px; }
  .autoread { display: flex; align-items: center; gap: 6px; font-size: 12px; }
</style>
