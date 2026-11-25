<script lang="ts">
  /** Circular gauge. `value/max` drives the arc; the centre shows `label` (defaults to value). */
  let { value, max, soft = null, label, sub, size = 112 }: {
    value: number; max: number | null; soft?: number | null; label?: string; sub?: string; size?: number;
  } = $props();

  const r = $derived(size / 2 - 8);
  const c = $derived(2 * Math.PI * r);
  const ratio = $derived(max ? Math.min(1, value / max) : 0);
  const softStart = $derived(max && soft ? (soft - 1) / max : null);
  const inSoft = $derived(soft !== null && soft !== undefined && value + 1 >= soft);
</script>

<div class="ring" style:width="{size}px" style:height="{size}px">
  <svg viewBox="0 0 {size} {size}" width={size} height={size}>
    <g transform="rotate(-90 {size / 2} {size / 2})">
      <circle cx={size / 2} cy={size / 2} {r} class="track" />
      {#if softStart !== null}
        <circle cx={size / 2} cy={size / 2} {r} class="softzone"
          stroke-dasharray="{c * (1 - softStart)} {c}" stroke-dashoffset={-c * softStart} />
      {/if}
      {#if max}
        <circle cx={size / 2} cy={size / 2} {r} class="value" class:soft={inSoft} stroke-dasharray="{c * ratio} {c}" />
      {/if}
    </g>
  </svg>
  <div class="center">
    <span class="num">{label ?? value}</span>
    {#if sub}<span class="sub">{sub}</span>{/if}
  </div>
</div>

<style>
  .ring { position: relative; flex: none; }
  svg { display: block; }
  circle { fill: none; stroke-width: 8; }
  .track { stroke: var(--track); }
  .softzone { stroke: rgba(255, 110, 90, 0.25); }
  .value { stroke: var(--top); stroke-linecap: round; filter: drop-shadow(0 0 4px var(--glow)); transition: stroke-dasharray 0.4s ease; }
  .value.soft { stroke: var(--warn); }
  .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .num { font-family: var(--num-font); font-size: 32px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
  .sub { font-size: 10px; color: var(--muted); margin-top: 3px; }
</style>
