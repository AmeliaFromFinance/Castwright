<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { EditorState } from '@codemirror/state';
  import { javascript } from '@codemirror/lang-javascript';
  import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
  import { tags as t } from '@lezer/highlight';

  interface Props {
    value: string;
    label: string;
    minLines?: number;
    onchange: (v: string) => void;
  }

  let { value, label, minLines = 6, onchange }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | null = null;

  const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword], color: 'var(--accent-text)' },
    { tag: [t.string, t.special(t.string)], color: 'var(--ok)' },
    { tag: [t.number, t.bool, t.null], color: 'var(--warn)' },
    { tag: [t.lineComment, t.blockComment], color: 'var(--text-faint)', fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--text)', fontWeight: '600' },
    { tag: t.propertyName, color: 'var(--text-muted)' }
  ]);

  const makeTheme = (lines: number) =>
    EditorView.theme({
    '&': { fontSize: '12px', background: 'var(--bg-2)', color: 'var(--text)', borderRadius: 'var(--radius)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
    '.cm-content': { caretColor: 'var(--text)', minHeight: `${lines * 18.6}px` },
    '.cm-gutters': { background: 'transparent', color: 'var(--text-faint)', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { background: 'color-mix(in srgb, var(--bg-3) 55%, transparent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      background: 'color-mix(in srgb, var(--accent) 35%, transparent) !important'
    },
    '.cm-cursor': { borderLeftColor: 'var(--text)' },
    '.cm-matchingBracket': { background: 'var(--bg-3)', outline: '1px solid var(--border-strong)' },
    '.cm-tooltip': { background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--text)' }
  });

  onMount(() => {
    if (!host) return;
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          javascript(),
          syntaxHighlighting(highlight),
          makeTheme(minLines),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onchange(u.state.doc.toString());
          })
        ]
      })
    });
    return () => {
      view?.destroy();
      view = null;
    };
  });

  $effect(() => {
    const v = value;
    if (view && v !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    }
  });
</script>

<div class="code" bind:this={host}></div>

<style>
  .code {
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
    max-height: 360px;
    display: flex;
  }
  .code:focus-within {
    border-color: var(--focus);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 28%, transparent);
  }
  .code :global(.cm-editor) {
    flex: 1;
    min-width: 0;
  }
</style>
