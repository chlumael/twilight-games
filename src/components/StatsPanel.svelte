<script lang="ts">
  import { GAMES } from "../lib/games";
  import { gameStats, luckLabel } from "../lib/stats";
  import type { GameId, GameRecord } from "../lib/types";

  let { game, record, bannerName, onClose }: {
    game: GameId;
    record: GameRecord;
    /** 배너 ID → 보여 줄 이름 (팩에 없으면 입력한 이름 그대로) */
    bannerName: (id: string) => string;
    onClose: () => void;
  } = $props();

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
  <div class="shead">
    <strong>통계 · {def.name}</strong>
    <button onclick={onClose}>닫기</button>
  </div>

  {#if stats.pulls === 0}
    <p class="muted">아직 기록된 뽑기가 없습니다. 뽑기를 기록하면 여기에 통계가 쌓입니다.</p>
  {:else}
    <div class="grid">
      <div class="tile card"><span class="k">기록된 뽑기</span><b>{stats.pulls}회</b></div>
      <div class="tile card"><span class="k">{def.topLabel} 획득</span><b>{stats.tops}개</b></div>
      <div class="tile card"><span class="k">{def.topLabel} 평균</span><b>{num(stats.average)}뽑</b></div>
      {#if stats.spent}
        <div class="tile card"><span class="k">{stats.spent.label} 환산</span><b>{Math.round(stats.spent.amount).toLocaleString()}</b></div>
      {/if}
    </div>
    {#if stats.firstPull && stats.lastPull}
      <p class="muted small">기록 기간: {day(stats.firstPull)} ~ {day(stats.lastPull)} · 앱에 기록한 뽑기만 셉니다.</p>
    {/if}

    {#each stats.groups.filter((g) => g.pulls > 0) as g (g.groupId)}
      {@const luck = luckLabel(g)}
      <div class="group card">
        <div class="gtitle"><b>{g.name}</b>{#if luck}<span class="luck">{luck}</span>{/if}</div>
        <div class="rows">
          <div><span>뽑기 수</span><b>{g.pulls}회</b></div>
          <div><span>{def.topLabel} 획득</span><b>{g.tops}개</b></div>
          <div><span>평균</span><b>{num(g.average)}뽑</b></div>
          <div><span>가장 빨리 / 가장 늦게</span><b>{g.best ?? "–"} / {g.worst ?? "–"}뽑</b></div>
          <div><span>마지막 {def.topLabel} 이후</span><b>{g.since}뽑</b></div>
          {#if g.featuredWon + g.featuredLost > 0}
            <div><span>픽업 성공</span><b>{pct(g.featuredRate)} ({g.featuredWon}승 {g.featuredLost}패)</b></div>
          {/if}
          {#if g.pityRatio !== null && g.tops >= 3}
            <div><span>천장 대비 평균</span><b>{pct(g.pityRatio)}</b></div>
          {/if}
        </div>
        {#if g.pityRatio !== null && g.tops >= 3}
          <div class="bar"><div style:width="{Math.min(100, g.pityRatio * 100)}%"></div></div>
          <p class="muted small">천장 대비 평균은 "평균 뽑기 수 ÷ 천장"입니다. 낮을수록 일찍 나온 것입니다.</p>
        {:else if g.pityRatio !== null}
          <p class="muted small">{def.topLabel} 기록이 3개 이상 쌓이면 천장 대비 평균과 운 평가가 표시됩니다.</p>
        {/if}
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
                <span class="count">{h.count}</span>
                <span class="name">{h.pull.name ?? "이름 미입력"}</span>
                {#if h.pull.featured === true}<span class="badge win">픽업</span>{:else if h.pull.featured === false}<span class="badge">픽뚫</span>{/if}
                <span class="when">{day(h.pull.time)}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

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
  .stats { display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
  .shead { display: flex; justify-content: space-between; align-items: center; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .tile { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; }
  .tile b { font-size: 18px; color: var(--text); }
  .k, .rows span, .when { color: var(--muted); }
  .small { font-size: 11px; margin: 0; line-height: 1.4; }
  .group { display: flex; flex-direction: column; gap: 8px; padding: 10px; }
  .gtitle { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--text); }
  .luck { padding: 1px 8px; border-radius: var(--btn-radius); background: color-mix(in srgb, var(--accent) 25%, transparent); font-size: 11px; font-weight: 700; }
  .rows { display: flex; flex-direction: column; gap: 4px; }
  .rows > div { display: flex; justify-content: space-between; gap: 8px; }
  .rows b { color: var(--text); }
  .bar { height: 5px; border-radius: 3px; background: color-mix(in srgb, var(--muted) 25%, transparent); overflow: hidden; }
  .bar div { height: 100%; background: var(--accent); }
  .hits { display: flex; flex-direction: column; gap: 3px; }
  .hit { display: grid; grid-template-columns: 30px 1fr auto auto; align-items: center; gap: 6px; padding: 4px 6px; border-radius: var(--btn-radius); background: color-mix(in srgb, var(--top) 12%, transparent); }
  .hit.lost { background: color-mix(in srgb, var(--muted) 14%, transparent); }
  .count { font-weight: 700; color: var(--top); text-align: right; }
  .name { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
