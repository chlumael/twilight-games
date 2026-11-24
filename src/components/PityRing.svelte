<script lang="ts">
  let { pity, hard, soft, size = 112 }: { pity: number; hard: number | null; soft: number | null; size?: number } = $props();

  const r = $derived(size / 2 - 8);
  const c = $derived(2 * Math.PI * r);
  const ratio = $derived(hard ? Math.min(1, pity / hard) : 0);
  const softStart = $derived(hard && soft ? (soft - 1) / hard : null);
  const inSoft = $derived(soft !== null && pity + 1 >= soft);
</script>

<div class="ring" style:width="{size}px" style:height="{size}px">
  <svg viewBox="0 0 {size} {size}" width={size} height={size}>
    <g transform="rotate(-90 {size / 2} {size / 2})">
      <circle cx={size / 2} cy={size / 2} {r} class="track" />
      {#if softStart !== null}
        <circle cx={size / 2} cy={size / 2} {r} class="softzone"
          stroke-dasharray="{c * (1 - softStart)} {c}" stroke-dashoffset={-c * softStart} />
      {/if}
      {#if hard}
        <circle cx={size / 2} cy={size / 2} {r} class="value" class:soft={inSoft}
          stroke-dasharray="{c * ratio} {c}" />
      {/if}
    </g>
  </svg>
  <div class="center">
    <span class="num">{pity}</span>
    <span class="hard">{hard ? `/ ${hard}` : "천장 없음"}</span>
  </div>
</div>

<style>
  .ring { position: relative; flex: none; }
  svg { display: block; }
  circle { fill: none; stroke-width: 9; }
  .track { stroke: rgba(255, 255, 255, 0.08); }
  .softzone { stroke: rgba(255, 110, 90, 0.22); }
  .value { stroke: var(--a1); stroke-linecap: round; filter: drop-shadow(0 0 4px var(--a1)); transition: stroke-dasharray 0.4s ease; }
  .value.soft { stroke: #ff6e5a; filter: drop-shadow(0 0 6px #ff6e5a); }
  .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .num { font-size: 34px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
  .hard { font-size: 11px; color: var(--muted); margin-top: 2px; }
</style>
