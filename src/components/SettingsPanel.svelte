<script lang="ts">
  import { GAMES, GAME_IDS } from "../lib/games";
  import { emptyBaseline } from "../lib/ledger";
  import { listProcesses } from "../lib/api";
  import type { Settings } from "../lib/settings";
  import type { Baseline, GameId, GameRecord } from "../lib/types";

  let { settings, game, record, onSettings, onBaseline, onExport, onImport, onClose }: {
    settings: Settings;
    game: GameId;
    record: GameRecord;
    onSettings: (s: Settings) => void;
    onBaseline: (groupId: string, b: Baseline) => void;
    onExport: () => void;
    onImport: () => void;
    onClose: () => void;
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
</script>

<div class="settings">
  <header>
    <strong>설정</strong>
    <button class="icon" onclick={onClose} aria-label="닫기">✕</button>
  </header>

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

  <section>
    <h4>백업</h4>
    <div class="row">
      <button onclick={onExport}>내보내기</button>
      <button onclick={onImport}>가져오기</button>
    </div>
    <p class="muted hint">기록은 이 PC에만 저장되며 매일 자동 백업(7일)됩니다.</p>
  </section>
</div>

<style>
  .settings { display: flex; flex-direction: column; gap: 10px; }
  header { display: flex; justify-content: space-between; align-items: center; }
  h4 { margin: 0 0 4px; font-size: 12px; color: var(--accent); }
  section { display: flex; flex-direction: column; gap: 5px; }
  .row { display: flex; gap: 6px; align-items: center; }
  .hint { margin: 0; font-size: 11px; }
  .base { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; padding: 6px; background: var(--panel); border-radius: 6px; }
  .base .gname { grid-column: 1 / -1; font-weight: 600; }
  .base label { display: flex; flex-direction: column; gap: 2px; }
  .base label.check { flex-direction: row; align-items: center; gap: 4px; }
  .proc { display: grid; grid-template-columns: 56px 1fr auto; gap: 4px; align-items: center; }
  .proc select { max-width: 90px; }
</style>
