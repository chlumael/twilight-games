<script lang="ts">
  /** Segmented horizontal gauge (Arknights / Endfield style). */
  let { value, max, soft = null }: { value: number; max: number; soft?: number | null } = $props();

  const SEGMENTS = 20;
  const filled = $derived(Math.min(SEGMENTS, Math.round((value / max) * SEGMENTS)));
  const softSeg = $derived(soft ? Math.floor(((soft - 1) / max) * SEGMENTS) : SEGMENTS);
  const inSoft = $derived(soft !== null && value + 1 >= soft);
</script>

<div class="bar">
  <div class="numrow">
    <span class="num">{value}</span>
    <span class="max">/ {max}</span>
  </div>
  <div class="segs">
    {#each Array(SEGMENTS) as _, i}
      <span class="seg" class:on={i < filled} class:softzone={i >= softSeg} class:hot={inSoft && i < filled}></span>
    {/each}
  </div>
  <div class="ticks">
    <span>0</span>
    {#if soft}<span style:left="{((soft - 1) / max) * 100}%" class="mark">{soft - 1}</span>{/if}
    <span class="end">{max}</span>
  </div>
</div>

<style>
  .bar { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .numrow { display: flex; align-items: baseline; gap: 6px; }
  .num { font-family: var(--num-font); font-size: 46px; font-weight: 700; line-height: 0.9; font-style: italic; }
  .max { font-family: var(--num-font); font-size: 16px; color: var(--muted); }
  .segs { display: grid; grid-template-columns: repeat(20, 1fr); gap: 2px; height: 10px; }
  .seg { background: var(--track); transform: skewX(-20deg); }
  .seg.softzone { background: rgba(255, 110, 90, 0.18); }
  .seg.on { background: var(--a2); }
  .seg.hot { background: var(--warn); }
  .ticks { position: relative; height: 12px; font-size: 9px; color: var(--muted); font-family: var(--num-font); }
  .ticks span { position: absolute; top: 0; }
  .ticks .mark { transform: translateX(-50%); color: var(--warn); }
  .ticks .end { right: 0; }
</style>
