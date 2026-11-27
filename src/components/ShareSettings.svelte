<script lang="ts">
  // 설정 → 친구 공유 (DESIGN.md §8.5). 켜면 내 요약(닉네임·뽑기 수·최고 등급·운)이 친구 탭에 올라간다. 끄면 지운다.
  let { share, busy = false, onToggle, onNickname }: {
    share: { on: boolean; nickname: string };
    busy?: boolean;
    onToggle: (on: boolean) => void;
    onNickname: (name: string) => void;
  } = $props();
</script>

<div class="share">
  <label class="row">
    <span class="k">닉네임</span>
    <input value={share.nickname} maxlength="20" placeholder="친구 탭에 보일 이름" onchange={(e) => onNickname((e.currentTarget as HTMLInputElement).value)} />
  </label>
  <button class="tg" class:on={share.on} onclick={() => onToggle(!share.on)} aria-pressed={share.on} disabled={busy || !share.nickname.trim()}>
    <span class="sw"></span><span>친구 탭에 내 요약 공유</span>
  </button>
  <p class="muted hint">올라가는 것: 닉네임, 게임별 뽑기 수·최고 등급·운, 최근 최고 등급. 재화·이메일은 안 올라감</p>
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
</style>
