<script lang="ts">
  import type { HistoryRow } from "../lib/history";

  let { rows, isTop, onApply, onClear }: {
    rows: HistoryRow[];
    isTop: (name: string) => boolean;
    onApply: () => void;
    onClear: () => void;
  } = $props();

  const sorted = $derived([...rows].sort((a, b) => b.time.localeCompare(a.time)));
  const tops = $derived(rows.filter((r) => isTop(r.name)).length);
  const emergency = $derived(rows.filter((r) => r.emergency).length);
  const day = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
</script>

<div class="hist card">
  <div class="head"><b>엔드필드 공식 기록 {rows.length}개 읽음</b><span class="muted">6성 {tops}개</span></div>
  <p class="muted small">
    "다음"을 눌러 쪽을 넘기면서 각 쪽을 1초쯤 보여 주면 계속 쌓입니다. 다 읽었으면 "기록에 반영"을 누르세요.
    공식 기록이 덮는 시간대의 기존 기록(화면 감지·직접 입력)은 공식 기록으로 바뀝니다.
    {#if emergency}긴급 모집 {emergency}개는 천장에 안 들어가서 넣지 않습니다.{/if}
  </p>
  <div class="list">
    {#each sorted.slice(0, 30) as r, i (i)}
      <div class="row" class:top={isTop(r.name)} class:em={r.emergency}>
        <span class="when">{day(r.time)}</span><span class="name">{r.name}</span>
        <span class="ban">{r.emergency ? "긴급 모집" : r.banner}</span>
      </div>
    {/each}
  </div>
  <div class="actions">
    <button class="save" onclick={onApply}>기록에 반영</button>
    <button onclick={onClear}>비우기</button>
  </div>
</div>

<style>
  .hist { display: flex; flex-direction: column; gap: 6px; padding: 10px; font-size: 12px; }
  .head { display: flex; justify-content: space-between; color: var(--text); }
  .small { font-size: 11px; margin: 0; line-height: 1.45; }
  .list { display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow-y: auto; }
  .row { display: grid; grid-template-columns: 78px 1fr auto; gap: 6px; padding: 2px 4px; color: var(--text); }
  .row.top { background: color-mix(in srgb, var(--top) 30%, transparent); font-weight: 700; }
  .row.em { opacity: 0.55; }
  .when, .ban { color: var(--muted); font-size: 11px; }
  .actions { display: flex; gap: 6px; }
  .actions .save { flex: 1; }
</style>
