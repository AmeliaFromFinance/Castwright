<script lang="ts">
  import { onMount } from 'svelte';
  import { basicSetup } from 'codemirror';
  import { EditorState, type Extension } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
  import { tags as t } from '@lezer/highlight';
  import { html } from '@codemirror/lang-html';
  import { css } from '@codemirror/lang-css';
  import { javascript } from '@codemirror/lang-javascript';
  import { json } from '@codemirror/lang-json';

  interface Props {
    value: string;
    lang: 'html' | 'css' | 'javascript' | 'json';
    label: string;
    placeholder?: string;
    invalid?: boolean;
    onchange?: (v: string) => void;
  }

  let { value, lang, label, invalid = false, onchange }: Props = $props();

  let host = $state<HTMLDivElement>();
  let view: EditorView | null = null;
  let applying = false;

  const languages: Record<Props['lang'], () => Extension> = { html, css, javascript, json };

  // Colours from the app theme so the editor fits light and dark themes.
  const theme = EditorView.theme({
    '&': {
      height: '100%',
      fontSize: '12px',
      color: 'var(--text)',
      backgroundColor: 'var(--bg-0)'
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
    '.cm-content': { caretColor: 'var(--text)', padding: '8px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-0)',
      color: 'var(--text-faint)',
      border: 'none'
    },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--text) 4%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent) !important'
    },
    '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)', outline: 'none' },
    '.cm-tooltip': { backgroundColor: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--text)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
    '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-3)', border: 'none', color: 'var(--text-muted)' },
    '.cm-panels': { backgroundColor: 'var(--bg-1)', color: 'var(--text)' }
  });

  const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'color-mix(in srgb, #c792ea 70%, var(--text))' },
    { tag: [t.string, t.special(t.string), t.attributeValue], color: 'color-mix(in srgb, #a5d6a7 70%, var(--text))' },
    { tag: [t.number, t.bool, t.null, t.atom], color: 'color-mix(in srgb, #f9b872 70%, var(--text))' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--text-faint)', fontStyle: 'italic' },
    { tag: [t.tagName, t.typeName, t.className], color: 'color-mix(in srgb, #82aaff 70%, var(--text))' },
    { tag: [t.attributeName, t.propertyName], color: 'color-mix(in srgb, #9db8ff 70%, var(--text))' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'color-mix(in srgb, #7fdbca 70%, var(--text))' },
    { tag: [t.definition(t.variableName), t.variableName], color: 'var(--text)' },
    { tag: [t.punctuation, t.bracket, t.angleBracket, t.operator], color: 'var(--text-muted)' },
    { tag: t.invalid, color: 'var(--danger)' }
  ]);

  onMount(() => {
    if (!host) return;
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languages[lang](),
          theme,
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !applying) onchange?.(u.state.doc.toString());
          })
        ]
      })
    });
    return () => {
      view?.destroy();
      view = null;
    };
  });

  // Outside changes (undo, another layer) replace the text.
  $effect(() => {
    const v = value;
    if (!view || view.state.doc.toString() === v) return;
    applying = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    applying = false;
  });
</script>

<div class="code" class:invalid bind:this={host}></div>

<style>
  .code {
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-0);
  }
  .code:focus-within {
    border-color: var(--focus);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 28%, transparent);
  }
  .invalid,
  .invalid:focus-within {
    border-color: var(--danger);
  }
  .code :global(.cm-editor) {
    height: 100%;
  }
</style>
