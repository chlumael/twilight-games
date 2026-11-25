<script lang="ts">
  import type { Detection } from "../lib/detect";
  import { GAMES } from "../lib/games";

  let { detection, defaultGroup, guessFeatured, onSave, onDiscard }: {
    detection: Detection;
    /** 처음에 골라 둘 종류(지금 앱에서 보고 있는 종류) */
    defaultGroup: string;
    /** 최고 등급 이름이 이번 배너 픽업인지 (모르면 null) */
    guessFeatured: (groupId: string, name: string) => boolean | null;
    onSave: (groupId: string, count: number) => void;
    onDiscard: () => void;
  } = $props();

  const def = $derived(GAMES[detection.game]);
  // 처음 값만 쓰고 이후에는 사용자가 고친다
  // svelte-ignore state_referenced_locally
  let groupId = $state(defaultGroup);
  // svelte-ignore state_referenced_locally
  let count = $state(detection.count);
  const label = (k: string) => def.currencies.find((c) => c.key === k)?.label ?? k;
  const topRarity = $derived(detection.game === "genshin" ? 5 : 6);
  const shown = $derived([...detection.items].sort((a, b) => b.rarity - a.rarity));
  const time = $derived(new Date(detection.time).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
</script>

<div class="det card">
  <div class="head">
    <b>{def.shortName} 뽑기 감지</b>
    <span class="muted">{time}</span>
  </div>
  <div class="row">
    <span class="muted">줄어든 재화</span>
    <span>{Object.entries(detection.spent).map(([k, v]) => `${label(k)} ${v.toLocaleString()}`).join(", ") || "–"}</span>
  </div>
  <div class="row">
    <span class="muted">종류</span>
    <select bind:value={groupId}>
      {#each def.groups as g (g.id)}<option value={g.id}>{g.name}</option>{/each}
    </select>
  </div>
  <div class="row">
    <span class="muted">횟수</span>
    <span class="count">
      <button onclick={() => (count = Math.max(1, count - 1))}>−</button>
      <b>{count}회</b>
      <button onclick={() => (count = count + 1)}>+</button>
    </span>
  </div>
  {#if detection.uncertain}
    <p class="warn small">횟수가 확실하지 않습니다(화면에 안 나오는 재화를 썼거나 일부 화면을 놓침). 맞는지 확인해 주세요.</p>
  {/if}
  {#if shown.length}
    <div class="items">
      {#each shown as it, k (k)}
        {@const feat = it.rarity >= topRarity ? guessFeatured(groupId, it.name) : null}
        <span class="it r{it.rarity}">{it.rarity}성 {it.name}{feat === true ? " (픽업)" : feat === false ? " (픽뚫)" : ""}</span>
      {/each}
    </div>
    <p class="muted small">공개 화면에서 본 것만 적힙니다. 연출을 건너뛰면 일부가 빠질 수 있습니다.</p>
  {/if}
  <div class="actions">
    <button class="save" onclick={() => onSave(groupId, count)}>기록</button>
    <button onclick={onDiscard}>버리기</button>
  </div>
</div>

<style>
  .det { display: flex; flex-direction: column; gap: 6px; padding: 10px; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: center; color: var(--text); }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .count { display: inline-flex; align-items: center; gap: 8px; }
  .count button { padding: 2px 10px; }
  .small { font-size: 11px; margin: 0; line-height: 1.4; }
  .warn { color: var(--warn); }
  .items { display: flex; flex-wrap: wrap; gap: 4px; }
  .it { padding: 2px 7px; border-radius: var(--btn-radius); background: color-mix(in srgb, var(--muted) 18%, transparent); color: var(--text); }
  .it.r4 { background: color-mix(in srgb, #a259ff 30%, transparent); }
  .it.r5, .it.r6 { background: color-mix(in srgb, var(--top) 35%, transparent); font-weight: 700; }
  .actions { display: flex; gap: 6px; }
  .actions .save { flex: 1; }
</style>
