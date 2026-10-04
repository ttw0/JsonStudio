<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from '$lib/i18n';
  import Self from './JsonlJsonNode.svelte';

  type JsonValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

  type JsonlJsonEntry = {
    keyName: string | null;
    value: unknown;
    path: string;
    isLast: boolean;
  };

  let {
    keyName = null,
    value,
    path,
    depth,
    isLast = true,
    expandedPaths,
    onToggle,
  }: {
    keyName?: string | null;
    value: unknown;
    path: string;
    depth: number;
    isLast?: boolean;
    expandedPaths: SvelteSet<string>;
    onToggle: (path: string) => void;
  } = $props();

  let valueType = $derived(getValueType(value));
  let isContainer = $derived(valueType === 'object' || valueType === 'array');
  let isExpanded = $derived(expandedPaths.has(path));
  let entries = $derived.by(() => getEntries(value, path, valueType));
  let openToken = $derived(valueType === 'array' ? '[' : '{');
  let closeToken = $derived(valueType === 'array' ? ']' : '}');

  function getValueType(input: unknown): JsonValueType {
    if (input === null) return 'null';
    if (Array.isArray(input)) return 'array';
    if (typeof input === 'object') return 'object';
    if (typeof input === 'string') return 'string';
    if (typeof input === 'number' || typeof input === 'bigint') return 'number';
    return 'boolean';
  }

  function getEntries(input: unknown, parentPath: string, type: JsonValueType): JsonlJsonEntry[] {
    if (type === 'array' && Array.isArray(input)) {
      return input.map((childValue, index) => ({
        keyName: null,
        value: childValue,
        path: appendPath(parentPath, String(index)),
        isLast: index === input.length - 1,
      }));
    }

    if (type === 'object' && input && typeof input === 'object') {
      const objectEntries = Object.entries(input as Record<string, unknown>);
      return objectEntries.map(([childKey, childValue], index) => ({
        keyName: childKey,
        value: childValue,
        path: appendPath(parentPath, childKey),
        isLast: index === objectEntries.length - 1,
      }));
    }

    return [];
  }

  function appendPath(parentPath: string, key: string) {
    return `${parentPath}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
  }

  function formatPrimitive(input: unknown, type: JsonValueType) {
    if (type === 'string') return JSON.stringify(input);
    if (type === 'null') return 'null';
    return String(input);
  }
</script>

<div
  class="jsonl-json-node"
  class:jsonl-json-root={depth === 0}
  data-path={path}
  data-depth={depth}
  role={isContainer ? 'treeitem' : undefined}
  aria-expanded={isContainer ? isExpanded : undefined}
>
  <div class="jsonl-json-row" style={`--jsonl-depth: ${depth};`}>
    {#if isContainer}
      <button
        class="jsonl-json-toggle"
        type="button"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? $t('jsonl.collapseNode') : $t('jsonl.expandNode')}
        onclick={() => onToggle(path)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          {#if isExpanded}
            <path d="m4 6 4 4 4-4" />
          {:else}
            <path d="m6 4 4 4-4 4" />
          {/if}
        </svg>
      </button>
    {:else}
      <span class="jsonl-json-toggle-spacer" aria-hidden="true"></span>
    {/if}

    {#if keyName !== null}
      <span class="jsonl-json-key">{JSON.stringify(keyName)}</span>
      <span class="jsonl-json-punctuation">:</span>
    {/if}

    {#if isContainer}
      <span class="jsonl-json-punctuation">{openToken}</span>
      {#if !isExpanded && entries.length > 0}
        <span class="jsonl-json-collapsed-hint">… {entries.length}</span>
      {/if}
      {#if !isExpanded}
        <span class="jsonl-json-punctuation">{closeToken}</span>
        {#if !isLast}<span class="jsonl-json-punctuation">,</span>{/if}
      {/if}
    {:else}
      <span class={`jsonl-json-value jsonl-json-${valueType}`}>{formatPrimitive(value, valueType)}</span>
      {#if !isLast}<span class="jsonl-json-punctuation">,</span>{/if}
    {/if}
  </div>

  {#if isContainer && isExpanded}
    <div role="group">
      {#each entries as entry (entry.path)}
        <Self
          keyName={entry.keyName}
          value={entry.value}
          path={entry.path}
          depth={depth + 1}
          isLast={entry.isLast}
          {expandedPaths}
          {onToggle}
        />
      {/each}
    </div>
    <div class="jsonl-json-closing-row" style={`--jsonl-depth: ${depth};`}>
      <span class="jsonl-json-toggle-spacer" aria-hidden="true"></span>
      <span class="jsonl-json-punctuation">{closeToken}</span>
      {#if !isLast}<span class="jsonl-json-punctuation">,</span>{/if}
    </div>
  {/if}
</div>

<style>
  .jsonl-json-node {
    min-width: max-content;
  }

  .jsonl-json-row,
  .jsonl-json-closing-row {
    display: flex;
    align-items: center;
    min-height: 22px;
    padding-left: calc(var(--jsonl-depth) * 18px);
    color: var(--text-primary);
    font: 12px/1.45 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
    font-size: 0;
    white-space: nowrap;
  }

  .jsonl-json-row > span,
  .jsonl-json-closing-row > span {
    font-size: 12px;
  }

  .jsonl-json-row:hover,
  .jsonl-json-node:focus-within > .jsonl-json-row {
    background: color-mix(in srgb, var(--bg-hover) 70%, transparent);
  }

  .jsonl-json-toggle,
  .jsonl-json-toggle-spacer {
    display: inline-flex;
    flex: 0 0 17px;
    align-items: center;
    justify-content: center;
    width: 17px;
    height: 20px;
    margin-right: 2px;
  }

  .jsonl-json-toggle {
    padding: 0;
    border: 0;
    color: var(--text-tertiary);
    background: transparent;
    cursor: pointer;
  }

  .jsonl-json-toggle:hover,
  .jsonl-json-toggle:focus-visible {
    color: var(--accent);
  }

  .jsonl-json-toggle svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .jsonl-json-key {
    color: var(--tree-key);
  }

  .jsonl-json-punctuation {
    color: var(--text-tertiary);
  }

  .jsonl-json-key + .jsonl-json-punctuation {
    margin-right: 4px;
  }

  .jsonl-json-value {
    white-space: pre;
  }

  .jsonl-json-string {
    color: var(--json-string);
  }

  .jsonl-json-number {
    color: var(--json-number);
  }

  .jsonl-json-boolean {
    color: var(--json-boolean);
  }

  .jsonl-json-null {
    color: var(--json-null);
    font-style: italic;
  }

  .jsonl-json-collapsed-hint {
    margin: 0 3px;
    color: var(--text-tertiary);
    font-size: 11px;
  }
</style>
