<script lang="ts">
  import { GAMES } from "../lib/games";
  import type { HistoryRow } from "../lib/history";
  import type { GameId } from "../lib/types";

  let { game, rows, isTop, needsChoice = false, defaultGroup, hideBelow = 0, onApply, onClear }: {
    /** 이 등급보다 낮은 줄은 목록에 보이지 않는다(원신 3성) — 횟수에는 들어간다 */
    hideBelow?: number;
    game: GameId;
    rows: HistoryRow[];
    isTop: (row: HistoryRow) => boolean;
    /** 배너 이름만으로 종류를 알 수 없는 게임(명일방주): 배너별로 종류를 고르게 한다 */
    needsChoice?: boolean;
    /** 배너 이름 → 처음 골라 둘 종류("" = 넣지 않음) */
    defaultGroup?: (banner: string) => string;
    onApply: (choices: Record<string, string>) => void;
    onClear: () => void;
  } = $props();

  const def = $derived(GAMES[game]);
  const sorted = $derived(
    rows.filter((r) => !(r.rarity != null && r.rarity < hideBelow)).sort((a, b) => b.time.localeCompare(a.time)),
  );
  const hidden = $derived(rows.length - sorted.length);
  const tops = $derived(rows.filter((r) => isTop(r)).length);
  const fours = $derived(rows.filter((r) => !isTop(r) && r.rarity === 4).length);
  const emergency = $derived(rows.filter((r) => r.emergency).length);
  const banners = $derived([...new Set(rows.map((r) => r.banner))]);
  let choices = $state<Record<string, string>>({});
  const choiceOf = (b: string) => choices[b] ?? defaultGroup?.(b) ?? "";
  const day = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
</script>

<div class="hist card">
  <div class="head"><b>{def.shortName} 공식 기록 {rows.length}개 읽음</b><span class="muted">{def.topLabel} {tops}개{fours ? ` · 4성 ${fours}개` : ""}</span></div>
  <p class="muted small">
    쪽을 넘기거나 아래로 내리면서 각 화면을 1초쯤 보여 주면 계속 쌓입니다. 다 읽었으면 "기록에 반영"을 누르세요.
    공식 기록이 덮는 시간대의 기존 기록(화면 감지·직접 입력)은 공식 기록으로 바뀝니다.
    {#if emergency}긴급 모집 {emergency}개는 천장에 안 들어가서 넣지 않습니다.{/if}
    {#if hidden}3성 {hidden}개는 목록에 안 보이고 이름 없이 횟수로만 기록됩니다.{/if}
  </p>
  {#if needsChoice}
    <div class="choices">
      {#each banners as b (b)}
        <label class="row2"><span>{b}</span>
          <select value={choiceOf(b)} onchange={(e) => (choices = { ...choices, [b]: (e.currentTarget as HTMLSelectElement).value })}>
            <option value="">넣지 않음</option>
            {#each def.groups as g (g.id)}<option value={g.id}>{g.name}</option>{/each}
          </select>
        </label>
      {/each}
    </div>
  {/if}
  <div class="list">
    {#each sorted.slice(0, 40) as r, i (i)}
      <div class="row" class:top={isTop(r)} class:four={!isTop(r) && r.rarity === 4} class:em={r.emergency}>
        <span class="when">{day(r.time)}</span><span class="name">{r.name}</span>
        <span class="ban">{r.emergency ? "긴급 모집" : r.banner}</span>
      </div>
    {/each}
  </div>
  <div class="actions">
    <button class="save" onclick={() => onApply(Object.fromEntries(banners.map((b) => [b, choiceOf(b)])))}>기록에 반영</button>
    <button onclick={onClear}>비우기</button>
  </div>
</div>

<style>
  .hist { display: flex; flex-direction: column; gap: 6px; padding: 10px; font-size: 12px; }
  .head { display: flex; justify-content: space-between; color: var(--text); gap: 8px; }
  .small { font-size: 11px; margin: 0; line-height: 1.45; }
  .choices { display: flex; flex-direction: column; gap: 4px; }
  .row2 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .list { display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow-y: auto; }
  .row { display: grid; grid-template-columns: 78px 1fr auto; gap: 6px; padding: 2px 4px; color: var(--text); }
  .row.top { background: color-mix(in srgb, var(--top) 30%, transparent); font-weight: 700; }
  .row.four { background: color-mix(in srgb, #a259ff 22%, transparent); }
  .row.em { opacity: 0.55; }
  .when, .ban { color: var(--muted); font-size: 11px; }
  .actions { display: flex; gap: 6px; }
  .actions .save { flex: 1; }
</style>
