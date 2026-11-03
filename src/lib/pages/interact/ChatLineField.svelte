<script lang="ts">
  import type { ChatLine } from '$lib/bindings/ChatLine';
  import TemplateField from '$lib/editors/TemplateField.svelte';
  import type { Token } from '$lib/editors/tokens';
  import Switch from '$lib/ui/Switch.svelte';

  interface Props {
    label: string;
    line: ChatLine;
    tokens: Token[];
    hint?: string;
    onchange: (line: ChatLine) => void;
  }

  let { label, line, tokens, hint, onchange }: Props = $props();
</script>

<div class="line" class:off={!line.on}>
  <Switch label="Send “{label}”" checked={line.on} onchange={(on) => onchange({ ...line, on })} />
  <div class="text">
    <TemplateField {label} value={line.text} {tokens} {hint} onchange={(text) => onchange({ ...line, text })} />
  </div>
</div>

<style>
  .line {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
    align-items: start;
  }
  .line > :global(:first-child) {
    margin-top: 22px;
  }
  .off .text {
    opacity: 0.55;
  }
</style>
