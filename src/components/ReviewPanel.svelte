<script lang="ts">
  // "확인할 것" 화면 (정리 2026-11-27: App.svelte에서 떼어 냄). 홈 맨 위 알림 줄에서 들어온다.
  // 방금 한 큰 변경(되돌리기), 읽어 둔 공식 기록, 자동 기록 목록, 림버스 추출 이력, 확인이 필요한 감지
  import DetectionCard from "./DetectionCard.svelte";
  import HistoryCard from "./HistoryCard.svelte";
  import { app } from "../lib/store.svelte";
  import { arknightsDefault, HISTORY_GAMES, type ScreenFlow } from "../lib/flows/screen.svelte";

  let { flow, onClose }: { flow: ScreenFlow; onClose: () => void } = $props();

  function undoLastApply() {
    app.undo();
    app.lastApply = null;
  }
</script>

<section class="review">
  <strong>확인 대기</strong>
  {#if app.lastApply}
    <div class="card autolog">
      <div class="arow"><span>{app.lastApply}</span><span class="abtn"><button onclick={undoLastApply}>되돌리기</button><button onclick={() => (app.lastApply = null)}>확인</button></span></div>
    </div>
  {/if}
  {#if flow.pending === 0}
    <p class="muted">확인할 기록이 없습니다.</p>
  {/if}
  {#each HISTORY_GAMES.filter((g) => flow.historyRowsOf(g).length) as g (g)}
    <HistoryCard game={g} rows={flow.historyRowsOf(g)} hideBelow={g === "genshin" ? 4 : 0} isTop={flow.isTopRow(g)} needsChoice={g === "arknights"}
      defaultGroup={g === "arknights" ? arknightsDefault : undefined}
      manualCount={flow.manualPulls(g)}
      onApply={(choices, replaceManual) => flow.applyHistory(g, choices, replaceManual)} onClear={() => flow.saveHistory(g, {})} />
  {/each}
  {#if flow.autoLog.length}
    <div class="card autolog">
      <b>자동으로 기록한 뽑기</b>
      {#each [...flow.autoLog].reverse() as e (e.id)}
        <div class="arow" class:unsure={e.uncertain}>
          <span>{new Date(e.time).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} {e.label}{e.uncertain ? " · 확실하지 않음" : ""}</span>
          <span class="abtn">
            <button onclick={() => flow.cancelAuto(e)}>취소</button>
            <button onclick={() => flow.confirmAuto(e)}>확인</button>
          </span>
        </div>
      {/each}
      <p class="muted lbsmall">잘못 잡힌 것만 "취소"하세요. "확인"은 목록에서 지우기만 합니다(기록은 그대로).</p>
    </div>
  {/if}
  {#if flow.limbusRows.length}
    <div class="card lbhist">
      <div class="lbhead"><b>림버스 추출 이력 {flow.limbusRows.length}개 읽음</b><span class="muted">000 {flow.limbusRows.filter((r) => r.top).length}개</span></div>
      <p class="muted lbsmall">최신이 위. 이력에는 시각이 없어서 앱의 최근 뽑기(감지·직접 입력)에 위에서부터 이름·000을 채우고, 앱이 모르던 줄은 지금 시각으로 넣습니다. 아래로 내리며 1초씩 보여 주면 이어 붙습니다.</p>
      <div class="lblist">{#each flow.limbusRows as r, i (i)}<div class:top={r.top}>{r.top ? "000 " : ""}{r.name}</div>{/each}</div>
      <div class="lbact"><button class="save" onclick={flow.applyLimbus}>기록에 반영</button><button onclick={() => flow.saveLimbus([])}>비우기</button></div>
    </div>
  {/if}
  {#each flow.detections as d (d.id)}
    <DetectionCard detection={d} defaultGroup={app.activeGroup(d.game)}
      guessFeatured={(gid, name) => flow.guessFeaturedFor(d.game, gid, name)}
      onSave={(gid, count) => flow.saveDetection(d, gid, count)}
      onDiscard={() => flow.discardDetection(d.id)} />
  {/each}
  <button onclick={onClose}>닫기</button>
</section>

<style>
  .review { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .autolog { display: flex; flex-direction: column; gap: 6px; padding: 10px; font-size: 12px; align-self: stretch; }
  .arow { display: flex; justify-content: space-between; align-items: center; gap: 6px; color: var(--text); }
  .arow.unsure { color: var(--warn); }
  .abtn { display: inline-flex; gap: 4px; flex: none; }
  .abtn button { padding: 2px 8px; font-size: 11px; }
  .lbhist { display: flex; flex-direction: column; gap: 6px; padding: 10px; font-size: 12px; align-self: stretch; }
  .lbhead { display: flex; justify-content: space-between; }
  .lbsmall { font-size: 11px; margin: 0; line-height: 1.45; }
  .lblist { display: flex; flex-direction: column; gap: 2px; max-height: 160px; overflow-y: auto; color: var(--text); }
  .lblist .top { font-weight: 700; color: var(--top); }
  .lbact { display: flex; gap: 6px; }
  .lbact .save { flex: 1; }
</style>
