<script lang="ts">
  import type { TopInfo } from "../lib/ledger";

  let { topLabel, lastSessionSize, showFeatured, onSubmit, onCancel }: {
    topLabel: string;
    lastSessionSize: number;
    showFeatured: boolean;
    /** position: null = record as a new single pull; otherwise 0-based index in the last session. */
    onSubmit: (position: number | null, info: TopInfo) => void;
    onCancel: () => void;
  } = $props();

  let name = $state("");
  let featured = $state<"yes" | "no" | "unknown">("yes");
  let mode = $state<"new" | "last">("new");
  let position = $state(1);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const info: TopInfo = {
      name: name.trim() || null,
      featured: !showFeatured ? null : featured === "unknown" ? null : featured === "yes",
    };
    onSubmit(mode === "new" ? null : Math.min(Math.max(position, 1), lastSessionSize) - 1, info);
  }
</script>

<form class="form" onsubmit={submit}>
  <strong class="top">{topLabel} 기록</strong>
  <label>이름 <input bind:value={name} placeholder="비워도 됨" /></label>
  {#if showFeatured}
    <label>
      픽업
      <select bind:value={featured}>
        <option value="yes">픽업 맞음</option>
        <option value="no">픽뚫</option>
        <option value="unknown">모름</option>
      </select>
    </label>
  {/if}
  <label>
    방식
    <select bind:value={mode}>
      <option value="new">새 1회 뽑기로 추가</option>
      <option value="last" disabled={lastSessionSize === 0}>직전 {lastSessionSize}회 중 하나로 표시</option>
    </select>
  </label>
  {#if mode === "last"}
    <label>몇 번째 <input type="number" min="1" max={lastSessionSize} bind:value={position} /></label>
  {/if}
  <div class="row">
    <button type="submit" class="primary">저장</button>
    <button type="button" onclick={onCancel}>취소</button>
  </div>
</form>

<style>
  .form { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--panel); border-radius: 8px; }
  label { display: grid; grid-template-columns: 56px 1fr; align-items: center; gap: 6px; }
  .row { display: flex; gap: 6px; justify-content: flex-end; }
</style>
