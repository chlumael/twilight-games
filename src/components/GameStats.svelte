<script lang="ts">
  import Portrait from "./Portrait.svelte";
  import { GAMES } from "../lib/games";
  import { gameStats, luckLabel } from "../lib/stats";
  import type { GameId, GameRecord } from "../lib/types";
  import { hitLabel, pullBatches } from "../lib/ledger";

  // 게임 하나의 자세한 통계 (전체 통계 화면 StatsPanel에서 "자세히"로 펼친다)
  let { game, record, bannerName, onRemove, onReset }: {
    game: GameId;
    record: GameRecord;
    /** 배너 ID → 보여 줄 이름 (팩에 없으면 입력한 이름 그대로) */
    bannerName: (id: string) => string;
    /** 기록 묶음 지우기 (묶음 키들, 되돌리기에 남길 이름) */
    onRemove?: (keys: string[], label: string) => void;
    /** 한 종류를 전부 지우고 시작 상태도 비우기 */
    onReset?: (groupId: string) => void;
  } = $props();

  // 기록 정리: 묶음별로 보고 잘못 들어간 것을 지운다
  let tidy = $state(false);
  let confirmReset = $state("");
  const batches = $derived(pullBatches(record));
  const SOURCE: Record<string, string> = { screen: "화면 감지", manual: "직접 입력", official: "공식 기록" };
  const bySource = $derived(Object.entries(SOURCE).map(([k, label]) => ({ k, label, n: batches.filter((b) => b.source === k).reduce((a, b) => a + b.count, 0) })).filter((x) => x.n > 0));
  const when = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

  const def = $derived(GAMES[game]);
  const stats = $derived(gameStats(record, game));
  const num = (n: number | null, digits = 1) => (n === null ? "–" : n.toFixed(digits).replace(/\.0$/, ""));
  const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 100)}%`);
  const day = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  };
  const groupName = (id: string) => def.groups.find((g) => g.id === id)?.name ?? id;
</script>

<section class="stats">

  {#if stats.pulls === 0}
    <p class="muted">아직 기록된 뽑기가 없습니다.</p>
  {:else}
    {#each stats.groups.filter((g) => g.pulls > 0) as g (g.groupId)}
      {@const luck = luckLabel(g, game)}
      <div class="group card">
        <div class="gtitle"><b>{g.name}</b>{#if luck}<span class="luck">{luck}</span>{/if}</div>
        <div class="rows">
          <div><span>가장 빨리 / 가장 늦게</span><b>{g.best ?? "–"} / {g.worst ?? "–"}뽑</b></div>
          <div><span>마지막 {def.topLabel} 이후</span><b>{g.since}뽑</b></div>
          {#if g.perFeatured !== null}<div><span>픽업 1개당 평균 (픽뚫 포함)</span><b>{g.perFeatured.toFixed(1)}뽑</b></div>{/if}

        </div>
        {#if g.rare.length}
          <div class="rare">
            <span class="k">4성 기록 {g.rare.length}개 (화면 읽기로 기록된 것)</span>
            <div class="chips">{#each g.rare.slice(0, 20) as p (p.id)}<span class="chip4">{p.name}</span>{/each}</div>
          </div>
        {/if}
        {#if g.hits.length}
          <div class="hits">
            {#each [...g.hits].reverse().slice(0, 12) as h (h.pull.id)}
              <div class="hit" class:lost={h.pull.featured === false}>
                <span class="count">{h.count}뽑</span>{#if h.toFeatured !== null && h.toFeatured !== h.count}<span class="muted">픽업까지 {h.toFeatured}뽑</span>{/if}
                <span class="name"><Portrait {game} name={h.pull.name} size={22} featured={h.pull.featured} />{h.pull.name ?? "이름 미입력"}</span>
                {#if hitLabel(h)}<span class="badge" class:win={h.pull.featured === true}>{hitLabel(h)}</span>{/if}
                <span class="when">{day(h.pull.time)}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    {#if onRemove}
      <div class="group card">
        <div class="gtitle"><b>기록 정리</b><button onclick={() => (tidy = !tidy)}>{tidy ? "접기" : "펼치기"}</button></div>
        <div class="bmeta">{#each bySource as x (x.k)}<span>{x.label} {x.n}회</span>{/each}</div>
        {#if tidy}
          {#each bySource.filter((x) => x.k === "screen") as x (x.k)}
            <button onclick={() => onRemove(batches.filter((b) => b.source === "screen").map((b) => b.sessionId), `화면 감지 기록 ${x.n}회 지우기`)}>화면 감지 기록 {x.n}회 모두 지우기</button>
          {/each}
          {#if onReset}
            <div class="bmeta">
              {#each def.groups.filter((g) => record.pulls.some((p) => p.group === g.id) || record.baseline[g.id]) as g (g.id)}
                <button onclick={() => { if (confirmReset === g.id) { onReset(g.id); confirmReset = ""; } else confirmReset = g.id; }}>
                  {confirmReset === g.id ? `한 번 더 누르면 ${g.name} 기록을 전부 지웁니다` : `${g.name} 처음부터 다시`}</button>
              {/each}
            </div>
          {/if}
          {#each batches.slice(0, 80) as b (b.sessionId)}
            <div class="trow">
              <span>{when(b.time)}</span><span>{groupName(b.group)}</span><b>{b.count}회</b><span>{SOURCE[b.source] ?? b.source}</span>
              {#if b.tops.length}<span class="bnames">{b.tops.join(", ")}</span>{/if}
              <button onclick={() => onRemove([b.sessionId], `${groupName(b.group)} ${b.count}회 지우기`)}>지우기</button>
            </div>
          {/each}
          <p class="muted small">지운 것은 "확인할 것"에서 되돌리기</p>
        {/if}
      </div>
    {/if}

    <div class="group card">
      <div class="gtitle"><b>배너별 기록</b></div>
      {#each stats.banners.slice(0, 15) as b (b.groupId + b.banner)}
        <div class="brow">
          <div class="bname">{b.banner ? bannerName(b.banner) : "배너 미지정"}</div>
          <div class="bmeta">
            <span>{groupName(b.groupId)}</span><span>{b.pulls}회</span>
            <span>{def.topLabel} {b.tops.length}개</span><span>{day(b.last)}</span>
          </div>
          {#if b.tops.length}<div class="bnames">{b.tops.map((p) => p.name ?? "이름 미입력").join(", ")}</div>{/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .trow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 4px 0; border-top: 1px solid var(--line); }
  .trow button { margin-left: auto; font-size: 11px; padding: 2px 8px; }
  .stats { display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
  .k, .rows span, .when { color: var(--muted); }
  .small { font-size: 11px; margin: 0; line-height: 1.4; }
  .group { display: flex; flex-direction: column; gap: 8px; padding: 10px; }
  .gtitle { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--text); }
  .luck { padding: 1px 8px; border-radius: var(--btn-radius); background: color-mix(in srgb, var(--accent) 25%, transparent); font-size: 11px; font-weight: 700; }
  .rows { display: flex; flex-direction: column; gap: 4px; }
  .rows > div { display: flex; justify-content: space-between; gap: 8px; }
  .rows b { color: var(--text); }
  .hits { display: flex; flex-direction: column; gap: 3px; }
  .hit { display: grid; grid-template-columns: auto auto 1fr auto auto; align-items: center; gap: 6px; padding: 4px 6px; border-radius: var(--btn-radius); background: color-mix(in srgb, var(--top) 12%, transparent); }
  .hit.lost { background: color-mix(in srgb, var(--muted) 14%, transparent); }
  .count { font-weight: 700; color: var(--top); text-align: right; white-space: nowrap; }
  .name { display: flex; align-items: center; gap: 5px; min-width: 0; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { font-size: 10px; padding: 0 5px; border-radius: 3px; background: color-mix(in srgb, var(--muted) 30%, transparent); }
  .badge.win { background: var(--top); color: #000; }
  .brow { display: flex; flex-direction: column; gap: 2px; padding: 5px 0; border-top: 1px solid color-mix(in srgb, var(--muted) 20%, transparent); }
  .bname { color: var(--text); font-weight: 600; word-break: keep-all; }
  .bmeta { display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--muted); font-size: 11px; }
  .bnames { color: var(--top); font-size: 11px; }
  .rare { display: flex; flex-direction: column; gap: 4px; }
  .chips { display: flex; flex-wrap: wrap; gap: 3px; }
  .chip4 { padding: 1px 6px; border-radius: var(--btn-radius); background: color-mix(in srgb, #a259ff 28%, transparent); color: var(--text); font-size: 11px; }
</style>
