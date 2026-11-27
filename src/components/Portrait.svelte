<script lang="ts">
  // 캐릭터·무기 아이콘. 그림이 없거나 못 불러오면 이름 첫 글자를 보여 준다.
  import { iconUrl } from "../lib/images.svelte";
  import type { GameId } from "../lib/types";

  let { game, name, size = 28, featured = null }: { game: GameId; name: string | null | undefined; size?: number; featured?: boolean | null } = $props();
  const url = $derived(iconUrl(game, name));
  let broken = $state(false);
  $effect(() => { void url; broken = false; });
</script>

<span class="pt" class:feat={featured === true} style:width="{size}px" style:height="{size}px" title={name ?? ""}>
  {#if url && !broken}
    <img src={url} alt="" loading="lazy" decoding="async" onerror={() => (broken = true)} />
  {:else}
    <span class="ch" style:font-size="{Math.round(size * 0.45)}px">{(name ?? "?").trim().slice(0, 1)}</span>
  {/if}
</span>

<style>
  .pt { flex: none; display: inline-grid; place-items: center; border-radius: 22%; overflow: hidden; background: color-mix(in srgb, var(--muted) 22%, transparent); box-shadow: inset 0 0 0 1px var(--line); }
  .pt.feat { box-shadow: inset 0 0 0 2px var(--top); }
  img { width: 100%; height: 100%; object-fit: cover; }
  .ch { color: var(--muted); font-weight: 700; line-height: 1; }
</style>
