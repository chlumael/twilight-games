<script lang="ts">
  import * as api from "../lib/api";
  import { GAMES } from "../lib/games";
  import { frameText, type ScreenFrame, type ScreenReading } from "../lib/recognize";
  import type { GameId } from "../lib/types";

  let { game, currency, reading, message, frame, result, onCurrency }: {
    game: GameId;
    currency: Record<string, number>;
    /** 화면 읽기가 켜져 있는지, 알림 문구, 마지막으로 읽은 화면과 해석 결과 (App이 받아서 넘긴다) */
    reading: boolean;
    message: string;
    frame: ScreenFrame | null;
    result: ScreenReading | null;
    /** 읽은 재화를 적용한다 */
    onCurrency: (values: Record<string, number>) => void;
  } = $props();

  const supported = api.screenSupported;
  const pc = api.inTauri;
  let showRaw = $state(false);
  let copied = $state(false);

  const label = (g: GameId, key: string) => GAMES[g].currencies.find((c) => c.key === key)?.label ?? key;
  const changed = $derived(result && result.game === game
    ? Object.entries(result.currency).filter(([k, v]) => currency[k] !== v) : []);

  async function copy() {
    if (!frame) return;
    try { await navigator.clipboard.writeText(frameText(frame)); copied = true; setTimeout(() => (copied = false), 1500); } catch { showRaw = true; }
  }
</script>

<section class="screen card">
  <div class="shead">
    <strong>화면 읽기 (시험 기능)</strong>
    {#if supported}
      <button onclick={() => api.screenRead(!reading)}>{reading ? "끄기" : "켜기"}</button>
    {/if}
  </div>
  {#if !supported}
    <p class="muted small">게임 위에 띄운 창(안드로이드)이나 PC판에서 쓸 수 있습니다.</p>
  {:else}
    {#if pc}
      <p class="muted small">프로그램을 켜면 함께 시작합니다. 앞에 떠 있는 창(게임)을 읽고, 이 프로그램 창은 읽지 않습니다. 가챠 화면이 보이면 1초마다, 그 외에는 2.5초마다 읽습니다. 화면은 이 컴퓨터 안에서만 읽고 그림은 저장하거나 밖으로 보내지 않습니다. 게임은 창 모드나 테두리 없는 창 모드를 권합니다(전체 화면 전용 모드는 검게 찍힐 수 있음).</p>
    {:else}
      <p class="muted small">창을 띄울 때 함께 켜집니다(앱 설정에서 끌 수 있음). <b>창을 펼쳐 둔 동안은 게임을 가려서 읽지 않습니다</b> — 창을 접고 가챠 화면을 잠깐 띄운 뒤 다시 펼쳐 보세요(가챠 화면이 보이면 1초마다, 다른 화면에서는 2.5초마다 읽습니다). 화면 읽기는 켜져 있는 동안 다른 앱 화면도 읽으니 게임을 마치면 끄세요(알림을 눌러도 꺼짐). 화면은 기기 안에서만 읽고, 그림은 저장하거나 밖으로 보내지 않습니다. 가챠 메인 화면을 띄우면 재화와 배너를 읽어 아래에 보여 줍니다. 읽은 재화는 두 번 연속 같게 읽히면 앱에 자동으로 반영됩니다.</p>
    {/if}
    {#if message}<p class="warn small">{message}</p>{/if}
    {#if reading && !result}<p class="muted small">읽는 중… 게임의 가챠 화면을 열어 주세요.</p>{/if}
    {#if pc && frame}
      <p class="small" class:warn={frame.blank || frame.lines.length === 0}>
        마지막으로 읽은 창: {frame.width}×{frame.height}, 글자 {frame.lines.length}줄
        {#if frame.blank} — 화면이 한 가지 색으로만 찍혔습니다. 게임을 창 모드나 테두리 없는 창 모드로 바꿔 보세요.
        {:else if frame.lines.length === 0} — 글자를 하나도 읽지 못했습니다.{/if}
      </p>
    {/if}
  {/if}

  {#if result}
    <div class="found">
      <div class="row"><span>읽은 화면</span><b>{GAMES[result.game].name} 가챠 메인</b></div>
      {#if result.banner}<div class="row"><span>배너</span><b>{result.banner}</b></div>{/if}
      {#if result.until}<div class="row"><span>종료 표시</span><b>{result.until}</b></div>{/if}
      {#if result.toTop !== null}<div class="row"><span>화면에 적힌 천장까지</span><b>{result.toTop}회</b></div>{/if}
      {#if result.toFeatured !== null}<div class="row"><span>화면에 적힌 픽업 확정까지</span><b>{result.toFeatured}회</b></div>{/if}
      {#each result.notes ?? [] as n (n)}<div class="row"><span>화면 표시</span><b>{n}</b></div>{/each}
      {#each Object.entries(result.currency) as [k, v] (k)}
        <div class="row"><span>{label(result.game, k)}</span><b>{v.toLocaleString()}{#if result.game === game && currency[k] !== v} <small>(기록: {(currency[k] ?? 0).toLocaleString()})</small>{/if}</b></div>
      {/each}
      {#if changed.length}
        <button class="apply" onclick={() => onCurrency(Object.fromEntries(changed))}>읽은 재화로 맞추기</button>
      {/if}
    </div>
  {/if}

  {#if frame}
    <div class="raw">
      <button onclick={copy}>{copied ? "복사됨" : "읽은 글자 복사"}</button>
      <button onclick={() => (showRaw = !showRaw)}>{showRaw ? "글자 숨기기" : `읽은 글자 보기 (${frame.lines.length}줄)`}</button>
    </div>
    <p class="muted small">인식이 틀리면 "읽은 글자 복사"로 복사해서 보내 주세요. 그 내용으로 규칙을 고칩니다. 복사되는 것은 마지막으로 본 <b>게임 가챠 화면</b>입니다(PC판은 마지막으로 앞에 있던 창).</p>
    {#if showRaw}<pre>{frameText(frame)}</pre>{/if}
  {/if}
</section>

<style>
  .screen { display: flex; flex-direction: column; gap: 8px; padding: 10px; font-size: 12px; }
  .shead { display: flex; justify-content: space-between; align-items: center; }
  .small { font-size: 11px; margin: 0; line-height: 1.45; }
  .warn { color: var(--warn); }
  .found { display: flex; flex-direction: column; gap: 4px; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row span { color: var(--muted); }
  .row b { color: var(--text); text-align: right; }
  .row small { color: var(--muted); font-weight: 400; }
  .apply { margin-top: 4px; }
  .raw { display: flex; gap: 6px; flex-wrap: wrap; }
  pre { margin: 0; max-height: 180px; overflow: auto; font-size: 10px; line-height: 1.35; white-space: pre-wrap; color: var(--muted); user-select: text; }
</style>
