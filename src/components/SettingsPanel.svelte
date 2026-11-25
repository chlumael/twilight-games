<script lang="ts">
  import { GAMES, GAME_IDS } from "../lib/games";
  import { emptyBaseline } from "../lib/ledger";
  import { android, androidMode, inTauri, listProcesses, openPcDownload, pcVersion } from "../lib/api";
  import { isNewer, latestRelease } from "../lib/version";
  import type { Settings } from "../lib/settings";
  import type { Baseline, GameId, GameRecord } from "../lib/types";

  let {
    settings, game, web = false, record, onSettings, onBaseline, onExport, onImport, onClose,
    syncConfigured = false, account = null, syncState = "idle", lastSync = null, onSignIn, onSignOut, onSync,
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
  } = $props();

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
    onBaseline(groupId, { ...baseline(groupId), ...patch });
  }
  // PC판 버전 확인: 설정을 열 때 한 번 확인하고, 버튼으로 다시 확인할 수 있다
  let pcVer = $state<string | null>(null);
  let pcUpdate = $state<"" | "checking" | "latest" | "new" | "wait" | "fail">("");
  let pcLatest = $state("");
  async function checkPcUpdate() {
    if (!pcVer) return;
    pcUpdate = "checking";
    const r = await latestRelease();
    if (!r) { pcUpdate = "fail"; return; }
    pcLatest = r.version;
    pcUpdate = !isNewer(r.version, pcVer) ? "latest" : r.hasPc ? "new" : "wait";
  }
  if (inTauri) void pcVersion().then((v) => { pcVer = v; void checkPcUpdate(); });

  let autoRead = $state(android?.autoScreenRead?.() ?? true);
</script>

<div class="settings">
  <header>
    <strong>설정</strong>
    <button class="icon" onclick={onClose} aria-label="닫기">✕</button>
  </header>

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
    <p class="muted hint">단축키: Ctrl+Alt+T 클릭 통과 · H 접기/펼치기 · Q 확인 대기 · Z 되돌리기</p>
  </section>
  {/if}

  <section>
    <h4>{GAMES[game].name} 시작 상태</h4>
    <p class="muted hint">앱을 쓰기 전 기록입니다. 처음 한 번만 입력하면 됩니다.</p>
    {#each GAMES[game].groups as g (g.id)}
      {@const b = baseline(g.id)}
      <div class="base">
        <span class="gname">{g.name}</span>
        <label>천장 누적 <input type="number" min="0" value={b.pity}
          onchange={(e) => editBaseline(g.id, { pity: Number((e.currentTarget as HTMLInputElement).value) || 0 })} /></label>
        {#if g.featuredRule !== "none"}
          <label class="check"><input type="checkbox" checked={b.guaranteed}
            onchange={(e) => editBaseline(g.id, { guaranteed: (e.currentTarget as HTMLInputElement).checked })} />
            {g.featuredRule === "fifty-fifty" ? "다음 확정" : "운명 포인트 1"}</label>
        {/if}
        {#if g.bannerCounters.length}
          <label>배너 이름 <input value={b.banner}
            onchange={(e) => editBaseline(g.id, { banner: (e.currentTarget as HTMLInputElement).value.trim() })} /></label>
          <label>이 배너 뽑기 수 <input type="number" min="0" value={b.bannerPulls}
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
          <button onclick={() => openPcDownload()}>설치 파일 받기</button>
        </div>
        <p class="muted hint">브라우저로 설치 파일을 받습니다. 받은 파일을 실행하면 기록은 그대로 두고 새 버전으로 바뀝니다.</p>
      {:else if pcUpdate === "latest"}
        <p class="muted hint">최신 버전입니다.</p>
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
      <p class="muted hint">앱을 켤 때 6시간마다 새 버전을 확인하고, 있으면 알려줍니다.</p>
      {#if android?.setAutoScreenRead}
        <label class="autoread">
          <input type="checkbox" checked={autoRead} onchange={(e) => { autoRead = (e.currentTarget as HTMLInputElement).checked; android?.setAutoScreenRead?.(autoRead); }} />
          창을 띄울 때 화면 읽기도 함께 시작
        </label>
        <p class="muted hint">켜 두면 "띄우기"를 누를 때 화면 녹화 허용 창이 바로 뜹니다. 허용은 안드로이드 규칙상 매번 한 번 눌러야 합니다.</p>
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
        <p class="muted hint">기록이 계정에 저장됩니다. 앱을 지우거나 기기를 바꿔도 같은 계정으로 로그인하면 돌아옵니다.</p>
      {:else if androidMode === "overlay"}
        <p class="muted hint">로그인은 앱 화면의 설정에서 할 수 있습니다.</p>
      {:else}
        <button onclick={onSignIn}>구글 계정으로 로그인</button>
        <p class="muted hint">로그인하면 기록이 계정에 저장되어, 앱을 지우거나 기기를 바꿔도 남습니다. 지금 이 기기의 기록은 계정 기록과 합쳐집니다.</p>
      {/if}
    </section>
  {/if}

  <section>
    <h4>백업</h4>
    <div class="row">
      <button onclick={onExport}>내보내기</button>
      <button onclick={onImport}>가져오기</button>
    </div>
    <p class="muted hint">
      {account ? "기록은 이 기기와 트래커 계정에 함께 저장됩니다." : androidMode ? "기록은 이 휴대폰 앱에만 저장됩니다. 앱을 지우면 사라지니 로그인하거나 가끔 내보내기로 백업하세요." : web ? "기록은 이 브라우저에만 저장됩니다. 브라우저 데이터를 지우면 사라지니 로그인하거나 가끔 내보내기로 백업하세요." : "기록은 이 PC에만 저장되며 매일 자동 백업(7일)됩니다."}
    </p>
  </section>
</div>

<style>
  .settings { display: flex; flex-direction: column; gap: 10px; }
  header { display: flex; justify-content: space-between; align-items: center; }
  h4 { margin: 0 0 4px; font-size: 12px; color: var(--accent); }
  section { display: flex; flex-direction: column; gap: 5px; }
  .row { display: flex; gap: 6px; align-items: center; }
  .hint { margin: 0; font-size: 11px; }
  .small { font-size: 11px; }
  .base { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; padding: 6px; background: var(--panel); border-radius: 6px; }
  .base .gname { grid-column: 1 / -1; font-weight: 600; }
  .base label { display: flex; flex-direction: column; gap: 2px; }
  .base label.check { flex-direction: row; align-items: center; gap: 4px; }
  .proc { display: grid; grid-template-columns: 56px 1fr auto; gap: 4px; align-items: center; }
  .proc select { max-width: 90px; }
  .autoread { display: flex; align-items: center; gap: 6px; font-size: 12px; }
</style>
