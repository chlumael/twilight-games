<script lang="ts">
  // 설정 → 친구 공유 (DESIGN.md §8.5). 로그인한 사람만. 공유를 켜면 들어간 그룹에 내 요약(뽑기 수·최고 등급·운)만 올라간다.
  import { validCode } from "../lib/share";

  let { share, busy = false, onToggle, onNickname, onCreate, onJoin, onLeave }: {
    share: { on: boolean; nickname: string; groups: { code: string; name: string }[] };
    busy?: boolean;
    onToggle: (on: boolean) => void;
    onNickname: (name: string) => void;
    onCreate: (name: string) => void;
    onJoin: (code: string) => void;
    onLeave: (code: string) => void;
  } = $props();

  let mode = $state<"" | "create" | "join">("");
  let text = $state("");
  let confirmLeave = $state("");
  let copied = $state("");

  function submit() {
    if (mode === "create") onCreate(text);
    else if (mode === "join" && validCode(text)) onJoin(text.trim().toUpperCase());
    mode = "";
    text = "";
  }
  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); copied = code; setTimeout(() => (copied = ""), 1500); } catch { /* 복사가 막힌 환경 */ }
  }
</script>

<div class="share">
  <label class="row">
    <span class="k">닉네임</span>
    <input value={share.nickname} maxlength="20" placeholder="친구에게 보일 이름" onchange={(e) => onNickname((e.currentTarget as HTMLInputElement).value)} />
  </label>
  <button class="tg" class:on={share.on} onclick={() => onToggle(!share.on)} aria-pressed={share.on} disabled={busy || !share.nickname.trim()}>
    <span class="sw"></span><span>내 요약 공유하기</span>
  </button>
  <p class="muted hint">공유되는 것: 닉네임, 게임별 뽑기 수·최고 등급·운, 최근 최고 등급. 재화·이메일은 안 올라감</p>

  {#each share.groups as g (g.code)}
    <div class="grp">
      <b>{g.name}</b>
      <button class="code" onclick={() => copy(g.code)} title="초대 코드 복사">{copied === g.code ? "복사됨" : g.code}</button>
      <span class="sp"></span>
      <button class="small" onclick={() => { if (confirmLeave === g.code) { onLeave(g.code); confirmLeave = ""; } else confirmLeave = g.code; }} disabled={busy}>
        {confirmLeave === g.code ? "한 번 더 누르면 나감" : "나가기"}
      </button>
    </div>
  {/each}

  {#if mode}
    <form class="row" onsubmit={(e) => { e.preventDefault(); submit(); }}>
      <input bind:value={text} maxlength={mode === "join" ? 10 : 30} placeholder={mode === "create" ? "그룹 이름" : "초대 코드 10자리"} />
      <button type="submit" disabled={busy || (mode === "join" ? !validCode(text) : !text.trim())}>{mode === "create" ? "만들기" : "참가"}</button>
      <button type="button" onclick={() => { mode = ""; text = ""; }}>취소</button>
    </form>
  {:else}
    <div class="row">
      <button onclick={() => (mode = "create")} disabled={busy}>그룹 만들기</button>
      <button onclick={() => (mode = "join")} disabled={busy}>코드로 참가</button>
    </div>
  {/if}
</div>

<style>
  .share { display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; align-items: center; gap: 6px; }
  .row input { flex: 1; min-width: 0; }
  .k { color: var(--muted); font-size: 12px; min-width: 3.5em; }
  .hint { margin: 0; font-size: 11px; }
  .tg { display: flex; align-items: center; gap: 8px; text-align: left; padding: 6px 8px; }
  .sw { flex: none; width: 30px; height: 17px; border-radius: 9px; background: var(--line); position: relative; }
  .sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--muted); transition: transform 0.15s; }
  .tg.on .sw { background: var(--good); }
  .tg.on .sw::after { transform: translateX(13px); background: #fff; }
  .grp { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--line); font-size: 13px; }
  .code { font-family: ui-monospace, monospace; font-size: 12px; padding: 2px 8px; letter-spacing: 0.05em; }
  .sp { flex: 1; }
  .small { font-size: 11px; padding: 2px 8px; }
</style>
