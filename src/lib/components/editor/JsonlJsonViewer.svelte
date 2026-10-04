<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from '$lib/i18n';
  import JsonlJsonNode from './JsonlJsonNode.svelte';

  type JsonlJsonViewerProps = {
    value: unknown;
    valueKey: string;
  };

  let { value, valueKey }: JsonlJsonViewerProps = $props();

  let expandedPaths = new SvelteSet<string>();
  let containerPaths = $state<string[] | null>(null);
  let previousValueKey = '';
  let previousValue: unknown;
  let valueType = $derived(getValueType(value));
  let defaultExpandedPaths = $derived(getDefaultExpandedPaths(value));
  let hasContainers = $derived(valueType === 'object' || valueType === 'array');
  let isFullyExpanded = $derived(
    containerPaths !== null
      && containerPaths.length > 0
      && containerPaths.every((path) => expandedPaths.has(path)),
  );

  $effect(() => {
    if (valueKey === previousValueKey && value === previousValue) return;
    previousValueKey = valueKey;
    previousValue = value;
    containerPaths = null;
    expandedPaths.clear();
    for (const path of defaultExpandedPaths) expandedPaths.add(path);
  });

  function togglePath(path: string) {
    if (expandedPaths.has(path)) expandedPaths.delete(path);
    else expandedPaths.add(path);
  }

  function expandAll() {
    const paths = getOrBuildContainerPaths();
    expandedPaths.clear();
    for (const path of paths) expandedPaths.add(path);
  }

  function collapseAll() {
    expandedPaths.clear();
  }

  function getOrBuildContainerPaths() {
    if (containerPaths === null) containerPaths = getContainerPaths(value);
    return containerPaths;
  }

  function getValueType(input: unknown) {
    if (input === null) return 'null';
    if (Array.isArray(input)) return 'array';
    if (typeof input === 'object') return 'object';
    if (typeof input === 'string') return 'string';
    if (typeof input === 'number' || typeof input === 'bigint') return 'number';
    return 'boolean';
  }

  function getChildren(input: unknown, path: string): Array<{ value: unknown; path: string }> {
    const type = getValueType(input);
    if (type === 'array' && Array.isArray(input)) {
      return input.map((childValue, index) => ({
        value: childValue,
        path: appendPath(path, String(index)),
      }));
    }

    if (type === 'object' && input && typeof input === 'object') {
      return Object.entries(input as Record<string, unknown>).map(([key, childValue]) => ({
        value: childValue,
        path: appendPath(path, key),
      }));
    }

    return [];
  }

  function getContainerPaths(input: unknown, path = '$'): string[] {
    const type = getValueType(input);
    if (type !== 'object' && type !== 'array') return [];

    const paths = [path];
    for (const child of getChildren(input, path)) {
      paths.push(...getContainerPaths(child.value, child.path));
    }
    return paths;
  }

  function getDefaultExpandedPaths(input: unknown, path = '$', depth = 0): string[] {
    const type = getValueType(input);
    if (type !== 'object' && type !== 'array') return [];

    const paths = depth <= 1 ? [path] : [];
    if (depth >= 1) return paths;

    for (const child of getChildren(input, path)) {
      paths.push(...getDefaultExpandedPaths(child.value, child.path, depth + 1));
    }
    return paths;
  }

  function appendPath(parentPath: string, key: string) {
    return `${parentPath}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
  }

</script>

<div class="jsonl-json-viewer" data-testid="jsonl-json-tree">
  <div class="jsonl-json-tree" class:has-toolbar={hasContainers} role="tree" aria-label={$t('jsonl.details')}>
    {#if hasContainers}
      <div class="jsonl-json-toolbar">
        <div class="jsonl-json-toolbar-actions">
          <button type="button" onclick={expandAll} disabled={isFullyExpanded}>
            {$t('jsonl.expandAll')}
          </button>
          <button type="button" onclick={collapseAll} disabled={expandedPaths.size === 0}>
            {$t('jsonl.collapseAll')}
          </button>
        </div>
      </div>
    {/if}
    <JsonlJsonNode
      value={value}
      path="$"
      depth={0}
      {expandedPaths}
      onToggle={togglePath}
    />
  </div>
</div>

<style>
  .jsonl-json-viewer {
    min-width: 0;
  }

  .jsonl-json-tree {
    position: relative;
    max-height: min(58vh, 560px);
    overflow: auto;
    padding: 7px 9px;
    border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    border-radius: 5px;
    background: var(--bg-primary);
    user-select: text;
  }

  .jsonl-json-tree.has-toolbar :global(.jsonl-json-root > .jsonl-json-row) {
    padding-right: 142px;
  }

  .jsonl-json-toolbar {
    position: absolute;
    top: 5px;
    right: 7px;
    z-index: 2;
  }

  .jsonl-json-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .jsonl-json-toolbar-actions button {
    min-height: 21px;
    padding: 0 6px;
    border: 0;
    border-radius: 4px;
    color: var(--text-tertiary);
    background: transparent;
    cursor: pointer;
    font-size: 10px;
    font-weight: 500;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .jsonl-json-toolbar-actions button:hover:not(:disabled),
  .jsonl-json-toolbar-actions button:focus-visible:not(:disabled) {
    color: var(--accent);
    background: var(--accent-glow);
  }

  .jsonl-json-toolbar-actions button:disabled {
    cursor: default;
    opacity: 0.45;
  }
</style>
