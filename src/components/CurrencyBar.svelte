<script lang="ts">
  import type { CurrencyDef } from "../lib/games";
  import { currencyIcon } from "../lib/icons";
  import type { GameId } from "../lib/types";

  let { game, currencies, values, canPull, onEdit }: {
    game: GameId;
    currencies: CurrencyDef[];
    values: Record<string, number>;
    canPull: number;
    onEdit: (key: string, value: string) => void;
  } = $props();
</script>

<section class="cbar">
  {#each currencies as c (c.key)}
    {@const icon = currencyIcon(game, c.key)}
    <label class="pill" title={c.label}>
      {#if icon}<img src={icon} alt="" />{:else}<span class="glyph"></span>{/if}
      <span class="name">{c.label}</span>
      <input type="number" min="0" value={values[c.key] ?? 0}
        onchange={(e) => onEdit(c.key, (e.currentTarget as HTMLInputElement).value)} />
    </label>
  {/each}
  <div class="can"><b>{canPull}</b><span>회 가능</span></div>
</section>

<style>
  .cbar { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  .pill {
    display: grid; grid-template-columns: 22px auto; grid-template-rows: auto auto; column-gap: 4px;
    align-items: center; padding: 3px 8px 3px 4px; min-width: 0;
    background: var(--pill-bg); border: var(--pill-border); border-radius: var(--pill-radius); color: var(--pill-fg);
  }
  .pill img, .glyph { grid-row: 1 / 3; width: 22px; height: 22px; object-fit: contain; }
  .glyph { width: 10px; height: 10px; margin: 6px; transform: rotate(45deg); border: 2px solid var(--a2); }
  .name { font-size: 9px; color: var(--pill-muted); white-space: nowrap; line-height: 1.1; }
  input {
    width: 68px; padding: 0; border: none; background: transparent; color: var(--pill-fg);
    font-family: var(--num-font); font-weight: 700; font-size: 13px; line-height: 1.1;
  }
  input::-webkit-inner-spin-button { display: none; }
  .can { margin-left: auto; display: flex; align-items: baseline; gap: 2px; font-size: 11px; color: var(--muted); }
  .can b { font-family: var(--num-font); font-size: 20px; color: var(--text); }
</style>
