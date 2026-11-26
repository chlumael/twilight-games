<script lang="ts">
  import type { Prompt } from "../lib/prompts";

  let { prompt, pc = false, onAnswer }: {
    prompt: Prompt;
    /** PC면 단축키 안내를 붙인다 */
    pc?: boolean;
    onAnswer: (yes: boolean) => void;
  } = $props();
</script>

<div class="prompt" role="alertdialog" aria-label={prompt.text}>
  <span class="text">{prompt.text}</span>
  <button class="yes" onclick={() => onAnswer(true)}>{prompt.yes}{#if pc} <small>Ctrl+Alt+Y</small>{/if}</button>
  <button onclick={() => onAnswer(false)}>{prompt.no}{#if pc} <small>Ctrl+Alt+N</small>{/if}</button>
</div>

<style>
  .prompt {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 10px; font-size: 12px;
    background: rgba(0, 0, 0, 0.55); border-bottom: 1px solid var(--line, rgba(255, 255, 255, 0.15));
  }
  .text { flex: 1 1 100%; font-weight: 700; }
  .yes { font-weight: 700; }
  small { opacity: 0.6; font-size: 10px; }
</style>
