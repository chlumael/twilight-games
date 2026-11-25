<script lang="ts">
  import type { Pull } from "../lib/types";

  let { pulls, slots = 40 }: { pulls: Pull[]; slots?: number } = $props();
  const padded = $derived([...Array(Math.max(0, slots - pulls.length)).fill(null), ...pulls.slice(-slots)] as (Pull | null)[]);
</script>

<div class="strip" style:--slots={slots} aria-label="최근 {slots}회 뽑기">
  {#each padded as p, i (i)}
    <span
      class="cell"
      class:empty={!p}
      class:top={p?.top}
      class:lost={p?.top && p.featured === false}
      class:r4={!p?.top && p?.rarity === 4}
      title={p ? (p.top ? `${p.name ?? "최고 등급"}${p.featured === false ? " (픽뚫)" : ""}` : p.name ? `${p.rarity ?? ""}성 ${p.name}` : "일반") : ""}
    ></span>
  {/each}
</div>

<style>
  .strip { display: grid; grid-template-columns: repeat(calc(var(--slots) / 2), 1fr); gap: 3px; }
  .cell { aspect-ratio: 1; border-radius: min(3px, var(--radius)); background: var(--cell); }
  .cell.empty { background: var(--cell-empty); }
  .cell.top { background: var(--top); box-shadow: 0 0 6px var(--glow); }
  .cell.r4 { background: #a259ff; opacity: 0.85; }
  .cell.lost { background: repeating-linear-gradient(135deg, var(--top) 0 3px, rgba(0, 0, 0, 0.35) 3px 5px); }
</style>
