<script lang="ts">
  import Dialog from '$lib/ui/Dialog.svelte';

  let { open = $bindable() }: { open: boolean } = $props();

  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
  const mod = mac ? '⌘' : 'Ctrl';

  const groups: Array<{ title: string; keys: Array<[string, string]> }> = [
    {
      title: 'Anywhere',
      keys: [
        [`${mod} K`, 'Search and run commands'],
        [`${mod} 1 – 4`, 'Overlays, Alerts, Automation, Activity'],
        [`${mod} ,`, 'Settings'],
        [`${mod} +  /  ${mod} -`, 'Zoom in and out'],
        [`${mod} 0`, 'Reset zoom'],
        [`${mod} /`, 'This list']
      ]
    },
    {
      title: 'Overlay editor',
      keys: [
        ['Arrows', 'Nudge 1 px (Shift: 10 px)'],
        [`${mod} D`, 'Duplicate layer'],
        [`${mod} Z  /  ${mod} Shift Z`, 'Undo and redo'],
        ['Delete', 'Remove layer'],
        ['Esc', 'Deselect'],
        [`Hold ${mod} while dragging`, 'Skip snapping'],
        ['Alt click', 'Pick the layer underneath']
      ]
    },
    {
      title: 'Panels',
      keys: [
        ['Drag a divider', 'Resize a panel'],
        ['Double-click a divider', 'Reset its size'],
        ['Arrows on a focused divider', 'Resize from the keyboard']
      ]
    }
  ];
</script>

<Dialog bind:open title="Keyboard shortcuts" width={560}>
  <div class="groups">
    {#each groups as g (g.title)}
      <section>
        <h3 class="eyebrow">{g.title}</h3>
        <dl>
          {#each g.keys as [k, what] (k)}
            <dt><kbd>{k}</kbd></dt>
            <dd>{what}</dd>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
</Dialog>

<style>
  .groups {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h3 {
    margin-bottom: 8px;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 0;
    font-size: 13px;
    align-items: center;
  }
  dd {
    margin: 0;
    color: var(--text-muted);
  }
  kbd {
    font-family: var(--font-mono);
    font-size: 11.5px;
    padding: 2px 7px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg-2);
    white-space: nowrap;
  }
</style>
