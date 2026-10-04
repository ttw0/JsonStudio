<script lang="ts">
  import { stringifyBigInt } from '$lib/utils/jsonBigInt.js';
  import { onDestroy } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from '$lib/i18n';
  import { cancelJsonlParse, parseJsonlAsync } from '$lib/services/jsonlWorker.js';
  import JsonlJsonViewer from './JsonlJsonViewer.svelte';

  type JsonlRow = {
    id: string;
    recordNumber: number;
    raw: string;
    kind: 'valid' | 'invalid';
    value: unknown;
    searchText: string;
    errorMessage?: string;
    errorColumn?: number | null;
  };

  type JsonlColumn = {
    name: string;
  };

  type JsonlSummary = {
    recordCount: number;
    validCount: number;
    invalidCount: number;
    emptyCount: number;
  };

  type JsonlDocument = {
    rows: JsonlRow[];
    columns: JsonlColumn[];
    summary: JsonlSummary;
  };

  type Filter = 'all' | 'valid' | 'invalid';
  type FieldOperator = '=' | '!=' | 'contains' | 'not-contains';
  type PageSize = 10 | 25 | 50 | 100;
  type SelectMenu = 'field' | 'operator' | 'page-size' | null;

  let {
    content,
    tabId,
    fileName,
    onOpenSource,
    onSummaryChange,
    onToast,
  } = $props<{
    content: string;
    tabId: string;
    fileName: string | null;
    onOpenSource: () => void;
    onSummaryChange: (summary: JsonlSummary | null) => void;
    onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  }>();

  const DEFAULT_PAGE_SIZE: PageSize = 10;
  const PAGE_SIZE_OPTIONS: PageSize[] = [10, 25, 50, 100];
  const ROW_PREVIEW_LENGTH = 260;

  let parsed = $state<JsonlDocument | null>(null);
  let isLoading = $state(false);
  let parseError = $state('');
  let searchQuery = $state('');
  let filter = $state<Filter>('all');
  let fieldName = $state('');
  let fieldOperator = $state<FieldOperator>('=');
  let fieldQuery = $state('');
  let openSelect = $state<SelectMenu>(null);
  let fieldOperatorLabel = $derived.by(() => {
    if (fieldOperator === '=') return $t('jsonl.operator.equals');
    if (fieldOperator === '!=') return $t('jsonl.operator.notEquals');
    if (fieldOperator === 'contains') return $t('jsonl.operator.contains');
    return $t('jsonl.operator.notContains');
  });
  let expandedRowIds = new SvelteSet<string>();
  let pageInput = $state('1');
  let currentPage = $state(1);
  let pageSize = $state<PageSize>(DEFAULT_PAGE_SIZE);
  let recordListElement = $state<HTMLDivElement | null>(null);
  let previousContent = '';
  let previousTabId = '';
  let parseVersion = 0;

  let filteredRows = $derived.by(() => {
    const rows = parsed?.rows ?? [];
    const query = searchQuery.trim().toLocaleLowerCase();
    const field = fieldName;
    const fieldValue = fieldQuery.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (filter === 'valid' && row.kind !== 'valid') return false;
      if (filter === 'invalid' && row.kind !== 'invalid') return false;
      if (query && !row.searchText.includes(query)) return false;
      if (!field || !fieldValue) return true;
      if (row.kind !== 'valid') return false;

      const value = getTopLevelFieldValue(row.value, field);
      if (value === undefined) return false;
      const normalizedValue = formatFieldValue(value).toLocaleLowerCase();
      if (fieldOperator === '=') return normalizedValue === fieldValue;
      if (fieldOperator === '!=') return normalizedValue !== fieldValue;
      if (fieldOperator === 'contains') return normalizedValue.includes(fieldValue);
      return !normalizedValue.includes(fieldValue);
    });
  });
  let totalPages = $derived(Math.max(1, Math.ceil(filteredRows.length / pageSize)));
  let displayPage = $derived(Math.min(currentPage, totalPages));
  let pageTotalText = $derived($t('jsonl.pageTotal').replace('{total}', String(totalPages)));
  let paginatedRows = $derived.by(() => {
    const start = (displayPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  });

  $effect(() => {
    if (content === previousContent && tabId === previousTabId) return;

    previousContent = content;
    previousTabId = tabId;
    const version = ++parseVersion;
    parsed = null;
    parseError = '';
    searchQuery = '';
    filter = 'all';
    fieldName = '';
    fieldOperator = '=';
    fieldQuery = '';
    openSelect = null;
    expandedRowIds.clear();
    currentPage = 1;
    pageInput = '1';
    pageSize = DEFAULT_PAGE_SIZE;
    recordListElement?.scrollTo({ top: 0 });
    onSummaryChange(null);
    isLoading = true;
    cancelJsonlParse();

    void parseJsonlAsync(content)
      .then((result) => {
        if (version !== parseVersion) return;
        parsed = result as JsonlDocument;
        isLoading = false;
        onSummaryChange(parsed.summary);
      })
      .catch((error) => {
        if (version !== parseVersion) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        isLoading = false;
        parseError = error instanceof Error ? error.message : $t('jsonl.parseFailed');
        onSummaryChange(null);
      });
  });

  onDestroy(() => {
    parseVersion += 1;
    cancelJsonlParse();
  });

  function truncateText(value: string, maxLength: number) {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
  }

  function getRowPreview(row: JsonlRow) {
    return truncateText(row.raw.trim(), ROW_PREVIEW_LENGTH);
  }

  function resetListView() {
    currentPage = 1;
    pageInput = '1';
    expandedRowIds.clear();
    recordListElement?.scrollTo({ top: 0 });
  }

  function handleSearchInput(event: Event) {
    searchQuery = (event.currentTarget as HTMLInputElement).value;
    resetListView();
  }

  function clearSearch() {
    searchQuery = '';
    resetListView();
  }

  function selectFilter(nextFilter: Filter) {
    filter = nextFilter;
    resetListView();
  }

  function toggleSelect(menu: Exclude<SelectMenu, null>, event: MouseEvent) {
    event.stopPropagation();
    openSelect = openSelect === menu ? null : menu;
  }

  function selectField(nextFieldName: string) {
    fieldName = nextFieldName;
    if (!nextFieldName) {
      fieldOperator = '=';
      fieldQuery = '';
    }
    openSelect = null;
    resetListView();
  }

  function selectOperator(nextOperator: FieldOperator) {
    fieldOperator = nextOperator;
    openSelect = null;
    resetListView();
  }

  function selectPageSize(nextPageSize: PageSize) {
    pageSize = nextPageSize;
    openSelect = null;
    resetListView();
  }

  function handleWindowClick(event: MouseEvent) {
    const target = event.target as Element | null;
    if (!target?.closest('.jsonl-select-wrap')) openSelect = null;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') openSelect = null;
  }

  function handleFieldQueryInput(event: Event) {
    fieldQuery = (event.currentTarget as HTMLInputElement).value;
    resetListView();
  }

  function clearFieldFilter() {
    fieldName = '';
    fieldOperator = '=';
    fieldQuery = '';
    openSelect = null;
    resetListView();
  }

  function goToPage(page: number) {
    const nextPage = Math.min(totalPages, Math.max(1, Math.trunc(page)));
    currentPage = nextPage;
    pageInput = String(nextPage);
    expandedRowIds.clear();
    recordListElement?.scrollTo({ top: 0 });
  }

  function goToRequestedPage() {
    const requestedPage = Number.parseInt(pageInput.trim(), 10);
    if (!Number.isFinite(requestedPage)) {
      pageInput = String(displayPage);
      return;
    }
    goToPage(requestedPage);
  }

  function handlePageKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    goToRequestedPage();
  }

  function toggleRow(rowId: string) {
    if (expandedRowIds.has(rowId)) expandedRowIds.delete(rowId);
    else expandedRowIds.add(rowId);
  }

  async function copyRow(row: JsonlRow) {
    try {
      await navigator.clipboard.writeText(row.raw);
      onToast($t('jsonl.copySuccess'));
    } catch (error) {
      console.error('Failed to copy JSONL row:', error);
      onToast($t('jsonl.copyFailed'), 'error');
    }
  }

  function getTopLevelFieldValue(value: unknown, field: string) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return Object.prototype.hasOwnProperty.call(value, field)
      ? (value as Record<string, unknown>)[field]
      : undefined;
  }

  function formatFieldValue(value: unknown) {
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
    return stringifyBigInt(value);
  }

</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<div class="jsonl-root" data-testid="jsonl-view">
  <div class="jsonl-heading-bar">
    <div class="jsonl-heading">
      <span class="jsonl-badge">JSONL</span>
      <div>
        <div class="jsonl-title">{$t('jsonl.title')}</div>
        <div class="jsonl-subtitle">{fileName || $t('jsonl.untitledHint')}</div>
      </div>
    </div>
    <button class="jsonl-source-button" type="button" onclick={onOpenSource}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14" />
      </svg>
      {$t('jsonl.openSource')}
    </button>
  </div>

  <div class="jsonl-controls">
    <label class="jsonl-search">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <input
        value={searchQuery}
        oninput={handleSearchInput}
        placeholder={$t('jsonl.searchPlaceholder')}
        aria-label={$t('jsonl.searchPlaceholder')}
      />
      {#if searchQuery}
        <button type="button" class="jsonl-clear-search" onclick={clearSearch} aria-label={$t('jsonl.clearSearch')}>×</button>
      {/if}
    </label>

    <div class="jsonl-filter-group" role="group" aria-label={$t('jsonl.filterLabel')}>
      <button type="button" class:active={filter === 'all'} onclick={() => selectFilter('all')}>
        {$t('jsonl.all')}
      </button>
      <button type="button" class:active={filter === 'valid'} onclick={() => selectFilter('valid')}>
        {$t('jsonl.valid')}
      </button>
      <button type="button" class:active={filter === 'invalid'} onclick={() => selectFilter('invalid')}>
        {$t('jsonl.errors')}
      </button>
    </div>

    <div class="jsonl-field-filter" role="group" aria-label={$t('jsonl.fieldFilterLabel')}>
      <div class="jsonl-select-wrap" class:is-disabled={!parsed || parsed.columns.length === 0} class:is-open={openSelect === 'field'}>
        <button
          class="jsonl-select"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={openSelect === 'field'}
          aria-label={$t('jsonl.fieldSelectLabel')}
          disabled={!parsed || parsed.columns.length === 0}
          onclick={(event) => toggleSelect('field', event)}
        >
          <span class:jsonl-select-placeholder={!fieldName}>{fieldName || $t('jsonl.allFields')}</span>
          <svg class:is-open={openSelect === 'field'} viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
        {#if openSelect === 'field'}
          <div class="jsonl-select-menu" role="listbox" aria-label={$t('jsonl.fieldSelectLabel')}>
            <button
              class="jsonl-select-option"
              class:is-active={!fieldName}
              type="button"
              role="option"
              aria-selected={!fieldName}
              onclick={() => selectField('')}
            >
              {$t('jsonl.allFields')}
            </button>
            {#each parsed?.columns ?? [] as column (column.name)}
              <button
                class="jsonl-select-option"
                class:is-active={fieldName === column.name}
                type="button"
                role="option"
                aria-selected={fieldName === column.name}
                title={column.name}
                onclick={() => selectField(column.name)}
              >
                {column.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="jsonl-select-wrap" class:is-disabled={!fieldName} class:is-open={openSelect === 'operator'}>
        <button
          class="jsonl-select"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={openSelect === 'operator'}
          aria-label={$t('jsonl.fieldOperatorLabel')}
          disabled={!fieldName}
          onclick={(event) => toggleSelect('operator', event)}
        >
          <span>{fieldOperatorLabel}</span>
          <svg class:is-open={openSelect === 'operator'} viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
        {#if openSelect === 'operator'}
          <div class="jsonl-select-menu" role="listbox" aria-label={$t('jsonl.fieldOperatorLabel')}>
            <button
              class="jsonl-select-option"
              class:is-active={fieldOperator === '='}
              type="button"
              role="option"
              aria-selected={fieldOperator === '='}
              onclick={() => selectOperator('=')}
            >
              {$t('jsonl.operator.equals')}
            </button>
            <button
              class="jsonl-select-option"
              class:is-active={fieldOperator === '!='}
              type="button"
              role="option"
              aria-selected={fieldOperator === '!='}
              onclick={() => selectOperator('!=')}
            >
              {$t('jsonl.operator.notEquals')}
            </button>
            <button
              class="jsonl-select-option"
              class:is-active={fieldOperator === 'contains'}
              type="button"
              role="option"
              aria-selected={fieldOperator === 'contains'}
              onclick={() => selectOperator('contains')}
            >
              {$t('jsonl.operator.contains')}
            </button>
            <button
              class="jsonl-select-option"
              class:is-active={fieldOperator === 'not-contains'}
              type="button"
              role="option"
              aria-selected={fieldOperator === 'not-contains'}
              onclick={() => selectOperator('not-contains')}
            >
              {$t('jsonl.operator.notContains')}
            </button>
          </div>
        {/if}
      </div>
      <input
        value={fieldQuery}
        oninput={handleFieldQueryInput}
        placeholder={$t('jsonl.fieldValuePlaceholder')}
        aria-label={$t('jsonl.fieldValueLabel')}
        disabled={!fieldName}
      />
      {#if fieldName || fieldQuery}
        <button
          class="jsonl-clear-field-filter"
          type="button"
          onclick={clearFieldFilter}
          aria-label={$t('jsonl.clearFieldFilter')}
        >×</button>
      {/if}
    </div>
  </div>

  {#if parseError}
    <div class="jsonl-state is-error" role="alert">
      <strong>{$t('jsonl.parseFailed')}</strong>
      <span>{parseError}</span>
    </div>
  {:else if isLoading}
    <div class="jsonl-state">
      <div class="jsonl-spinner"></div>
      <span>{$t('jsonl.parsingHint')}</span>
    </div>
  {:else if parsed && parsed.rows.length === 0}
    <div class="jsonl-state">
      <div class="jsonl-empty-icon">{'{}'}</div>
      <strong>{$t('jsonl.noRecords')}</strong>
      <span>{$t('jsonl.noRecordsHint')}</span>
    </div>
  {:else if parsed && filteredRows.length === 0}
    <div class="jsonl-state">
      <strong>{$t('jsonl.noMatches')}</strong>
      <span>{$t('jsonl.noMatchesHint')}</span>
    </div>
  {:else}
    <div
      class="jsonl-record-list"
      bind:this={recordListElement}
      role="list"
      aria-label={$t('jsonl.tableLabel')}
      data-testid="jsonl-record-list"
    >
      {#each paginatedRows as row (row.id)}
        {@const isExpanded = expandedRowIds.has(row.id)}
        <article class="jsonl-item" class:is-expanded={isExpanded} class:is-invalid={row.kind === 'invalid'} role="listitem">
          <div class="jsonl-row-line">
            <button
              class="jsonl-row-toggle"
              type="button"
              aria-expanded={isExpanded}
              aria-controls={`jsonl-detail-${row.id.replace(':', '-')}`}
              onclick={() => toggleRow(row.id)}
            >
              <span class="jsonl-line-label">
                {row.recordNumber}
              </span>
              <svg class="jsonl-row-chevron" viewBox="0 0 24 24" aria-hidden="true">
                {#if isExpanded}
                  <path d="m6 9 6 6 6-6" />
                {:else}
                  <path d="m9 6 6 6-6 6" />
                {/if}
              </svg>
              <span class="jsonl-preview" title={getRowPreview(row)}>{getRowPreview(row)}</span>
            </button>

            <div class="jsonl-row-actions">
              {#if row.kind === 'invalid'}
                <span class="jsonl-invalid-label">{$t('jsonl.invalid')}</span>
              {/if}
              <button
                class="jsonl-copy-button"
                type="button"
                onclick={() => copyRow(row)}
                title={$t('jsonl.copyRow')}
                aria-label={$t('jsonl.copyRow')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="8" y="8" width="11" height="11" rx="1.5" />
                  <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
                </svg>
              </button>
            </div>
          </div>

          {#if isExpanded}
            <div id={`jsonl-detail-${row.id.replace(':', '-')}`} class="jsonl-detail" role="region" aria-label={$t('jsonl.details')}>
              {#if row.kind === 'invalid'}
                <div class="jsonl-error-summary">
                  <span>{row.errorMessage || $t('jsonl.invalid')}</span>
                  {#if row.errorColumn}
                    <span>{$t('jsonl.column')} {row.errorColumn}</span>
                  {/if}
                </div>
              {/if}
              {#if row.kind === 'invalid'}
                <pre class="jsonl-invalid-source" data-testid="jsonl-expanded-json">{row.raw}</pre>
              {:else}
                <JsonlJsonViewer value={row.value} valueKey={row.id} />
              {/if}
            </div>
          {/if}
        </article>
      {/each}
    </div>

    <div class="jsonl-pagination" data-testid="jsonl-pagination" aria-label={$t('jsonl.paginationLabel')}>
      <div class="jsonl-pagination-center">
        <button
          class="jsonl-page-button"
          type="button"
          disabled={displayPage <= 1}
          onclick={() => goToPage(displayPage - 1)}
        >
          {$t('jsonl.previousPage')}
        </button>

        <span class="jsonl-page-status" aria-live="polite">
          {#if $t('jsonl.pageCurrentPrefix')}
            <span class="jsonl-page-current-prefix">{$t('jsonl.pageCurrentPrefix')}</span>
          {/if}
          <input
            value={pageInput}
            oninput={(event) => { pageInput = (event.currentTarget as HTMLInputElement).value; }}
            onkeydown={handlePageKeydown}
            inputmode="numeric"
            aria-label={$t('jsonl.pageInputLabel')}
            placeholder={$t('jsonl.pagePlaceholder')}
          />
          <span class="jsonl-page-separator" aria-hidden="true">/</span>
          <span class="jsonl-page-total-group">
            <span class="jsonl-page-total" data-testid="jsonl-page-total">{pageTotalText}</span>
            {#if $t('jsonl.pageCurrentSuffix')}
              <span class="jsonl-page-current-suffix">{$t('jsonl.pageCurrentSuffix')}</span>
            {/if}
          </span>
        </span>

        <button
          class="jsonl-page-button"
          type="button"
          disabled={displayPage >= totalPages}
          onclick={() => goToPage(displayPage + 1)}
        >
          {$t('jsonl.nextPage')}
        </button>

        <div class="jsonl-page-size-control" role="group" aria-label={$t('jsonl.pageSizeLabel')}>
          <div class="jsonl-select-wrap jsonl-page-size-select-wrap" class:is-open={openSelect === 'page-size'}>
            <button
              class="jsonl-select"
              type="button"
              data-testid="jsonl-page-size"
              aria-haspopup="listbox"
              aria-expanded={openSelect === 'page-size'}
              aria-label={$t('jsonl.pageSizeLabel')}
              onclick={(event) => toggleSelect('page-size', event)}
            >
              <span>{pageSize}</span>
              <svg class:is-open={openSelect === 'page-size'} viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 6 4 4 4-4" />
              </svg>
            </button>
            {#if openSelect === 'page-size'}
              <div class="jsonl-select-menu" role="listbox" aria-label={$t('jsonl.pageSizeLabel')}>
                {#each PAGE_SIZE_OPTIONS as option (option)}
                  <button
                    class="jsonl-select-option"
                    class:is-active={pageSize === option}
                    type="button"
                    role="option"
                    aria-selected={pageSize === option}
                    onclick={() => selectPageSize(option)}
                  >
                    {$t('jsonl.pageSizeOption').replace('{count}', String(option))}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .jsonl-root {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .jsonl-heading-bar,
  .jsonl-controls {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .jsonl-heading-bar {
    justify-content: space-between;
    min-height: 50px;
    padding: 8px 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
    background: var(--bg-primary);
  }

  .jsonl-heading,
  .jsonl-filter-group,
  .jsonl-search,
  .jsonl-source-button,
  .jsonl-field-filter,
  .jsonl-pagination-center,
  .jsonl-row-line,
  .jsonl-line-label,
  .jsonl-row-actions {
    display: flex;
    align-items: center;
  }

  .jsonl-heading {
    gap: 10px;
    min-width: 0;
  }

  .jsonl-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 24px;
    padding: 0 8px;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    border-radius: 5px;
    color: var(--accent);
    background: var(--accent-glow);
    font: 700 11px/1 'JetBrains Mono', ui-monospace, monospace;
    letter-spacing: 0.04em;
  }

  .jsonl-title {
    font-size: 13px;
    font-weight: 650;
  }

  .jsonl-subtitle {
    max-width: 46vw;
    overflow: hidden;
    color: var(--text-tertiary);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .jsonl-source-button {
    gap: 6px;
    min-height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-secondary);
    background: var(--bg-primary);
    cursor: pointer;
    font-size: 11px;
  }

  .jsonl-source-button:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .jsonl-source-button svg,
  .jsonl-search svg,
  .jsonl-row-chevron,
  .jsonl-copy-button svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .jsonl-controls {
    position: relative;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-primary);
    overflow: visible;
  }

  .jsonl-search {
    width: 240px;
    max-width: 28vw;
    flex: 0 1 240px;
    gap: 7px;
    height: 30px;
    min-width: 180px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-tertiary);
    background: var(--bg-primary);
  }

  .jsonl-search:focus-within {
    border-color: var(--accent);
  }

  .jsonl-search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    color: var(--text-primary);
    background: transparent;
    font-size: 12px;
    user-select: text;
  }

  .jsonl-clear-search {
    width: 20px;
    height: 20px;
    border: 0;
    color: var(--text-secondary);
    background: transparent;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }

  .jsonl-filter-group {
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-primary);
  }

  .jsonl-filter-group button {
    height: 26px;
    padding: 0 8px;
    border: 0;
    border-radius: 3px;
    color: var(--text-secondary);
    background: transparent;
    cursor: pointer;
    font-size: 11px;
  }

  .jsonl-filter-group button:hover,
  .jsonl-filter-group button.active {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .jsonl-filter-group button.active {
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .jsonl-field-filter {
    gap: 6px;
    min-width: 0;
    margin-left: auto;
    flex: 0 0 auto;
  }

  .jsonl-field-filter input {
    width: 111px;
    flex: 0 0 111px;
    height: 30px;
    min-width: 0;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    outline: 0;
    color: var(--text-primary);
    background: var(--bg-primary);
    font-size: 11px;
  }

  .jsonl-select-wrap {
    position: relative;
    min-width: 0;
  }

  .jsonl-select-wrap.is-open {
    z-index: 20;
  }

  .jsonl-field-filter .jsonl-select-wrap:first-child {
    width: 116px;
    flex: 0 0 116px;
  }

  .jsonl-field-filter .jsonl-select-wrap:nth-child(2) {
    width: 120px;
    flex: 0 0 120px;
  }

  .jsonl-select {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 30px;
    padding: 0 8px 0 9px;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 6px;
    outline: 0;
    color: var(--text-primary);
    background: var(--bg-primary);
    cursor: pointer;
    font: 11px/1.25 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
    text-align: left;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .jsonl-select > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .jsonl-select-placeholder {
    color: var(--text-tertiary);
  }

  .jsonl-select > svg {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
    margin-left: 8px;
    fill: none;
    stroke: var(--text-tertiary);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
    pointer-events: none;
    transition: transform 0.15s ease;
  }

  .jsonl-select > svg.is-open {
    transform: rotate(180deg);
  }

  .jsonl-select:hover:not(:disabled),
  .jsonl-select:focus-visible {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--bg-primary) 82%, var(--accent-glow));
  }

  .jsonl-select:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .jsonl-select-wrap.is-disabled .jsonl-select > svg {
    opacity: 0.45;
  }

  .jsonl-select-menu {
    position: absolute;
    top: calc(100% + 5px);
    left: 0;
    z-index: 30;
    display: flex;
    width: max-content;
    min-width: 100%;
    max-width: min(420px, calc(100vw - 32px));
    max-height: min(280px, calc(100vh - 150px));
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-primary) 94%, transparent);
    box-shadow: 0 10px 25px -5px color-mix(in srgb, var(--shadow, #000) 30%, transparent),
      0 8px 10px -6px color-mix(in srgb, var(--shadow, #000) 30%, transparent);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }

  .jsonl-select-option {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 28px;
    padding: 6px 10px;
    overflow: hidden;
    border: 0;
    border-radius: 5px;
    color: var(--text-secondary);
    background: transparent;
    cursor: pointer;
    font: 11px/1.25 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .jsonl-select-option:hover,
  .jsonl-select-option.is-active {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .jsonl-select-option.is-active {
    color: var(--accent);
    background: var(--accent-glow);
  }

  .jsonl-field-filter input:focus {
    border-color: var(--accent);
  }

  .jsonl-field-filter input:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .jsonl-clear-field-filter {
    flex: 0 0 20px;
    width: 20px;
    height: 20px;
    margin-left: -28px;
    border: 0;
    color: var(--text-tertiary);
    background: transparent;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }

  .jsonl-pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    min-height: 38px;
    padding: 4px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-primary);
  }

  .jsonl-pagination-center {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: center;
    flex-wrap: wrap;
    width: 100%;
    min-width: 0;
  }

  .jsonl-page-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }

  .jsonl-page-total-group {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
  }

  .jsonl-page-separator {
    color: var(--text-tertiary);
    font-weight: 500;
  }

  .jsonl-page-total {
    white-space: nowrap;
  }

  .jsonl-page-button {
    min-width: 62px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-secondary);
    background: var(--bg-primary);
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
  }

  .jsonl-page-button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .jsonl-page-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .jsonl-page-size-control {
    display: flex;
    align-items: center;
    margin-left: 4px;
    padding-left: 8px;
    border-left: 1px solid var(--border);
  }

  .jsonl-page-size-select-wrap {
    width: 52px;
    flex: 0 0 52px;
  }

  .jsonl-page-size-select-wrap .jsonl-select-menu {
    top: auto;
    bottom: calc(100% + 5px);
  }

  .jsonl-page-size-select-wrap .jsonl-select {
    padding-right: 5px;
    padding-left: 6px;
  }

  .jsonl-pagination-center input {
    width: 48px;
    height: 26px;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: 5px;
    outline: 0;
    color: var(--text-primary);
    background: var(--bg-primary);
    font: 11px 'JetBrains Mono', ui-monospace, monospace;
    text-align: center;
  }

  .jsonl-pagination-center input:focus-visible {
    border-color: var(--accent);
  }

  .jsonl-record-list {
    flex: 1 1 auto;
    min-height: 0;
    padding: 12px 16px 24px;
    overflow: auto;
    background: var(--bg-primary);
    overscroll-behavior: contain;
  }

  .jsonl-item {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--bg-primary);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--shadow, #000) 12%, transparent);
  }

  .jsonl-item + .jsonl-item {
    margin-top: 7px;
  }

  .jsonl-item:hover,
  .jsonl-item.is-expanded {
    border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
    background: color-mix(in srgb, var(--bg-hover) 42%, var(--bg-primary));
  }

  .jsonl-row-line {
    min-height: 44px;
  }

  .jsonl-row-toggle {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    gap: 9px;
    min-width: 0;
    min-height: 44px;
    padding: 7px 12px;
    border: 0;
    color: var(--text-primary);
    background: transparent;
    cursor: pointer;
    text-align: left;
  }

  .jsonl-row-toggle:hover .jsonl-preview,
  .jsonl-row-toggle:focus-visible .jsonl-preview {
    color: var(--text-primary);
  }

  .jsonl-line-label {
    gap: 6px;
    flex: 0 0 auto;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
  }

  .jsonl-row-chevron {
    flex: 0 0 auto;
    width: 13px;
    height: 13px;
    color: var(--text-tertiary);
  }

  .jsonl-preview {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font: 12px/1.35 'JetBrains Mono', ui-monospace, monospace;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .jsonl-row-actions {
    gap: 5px;
    flex: 0 0 auto;
    padding: 0 10px 0 4px;
  }

  .jsonl-invalid-label {
    flex: 0 0 auto;
    padding: 3px 5px;
    border: 1px solid color-mix(in srgb, var(--error) 35%, var(--border));
    border-radius: 3px;
    color: var(--error);
    background: color-mix(in srgb, var(--error) 10%, var(--bg-primary));
    font: 10px/1 'JetBrains Mono', ui-monospace, monospace;
    white-space: nowrap;
  }

  .jsonl-copy-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 4px;
    color: var(--text-tertiary);
    background: transparent;
    cursor: pointer;
  }

  .jsonl-copy-button:hover {
    color: var(--accent);
    background: var(--accent-glow);
  }

  .jsonl-detail {
    padding: 10px 14px 14px;
    border-top: 1px solid var(--border);
    background: var(--bg-primary);
  }

  .jsonl-error-summary {
    display: flex;
    gap: 8px;
    margin-bottom: 7px;
    color: var(--error);
    font: 10px/1.35 'JetBrains Mono', ui-monospace, monospace;
  }

  .jsonl-detail pre {
    max-height: min(58vh, 520px);
    margin: 0;
    overflow: auto;
    color: var(--text-primary);
    font: 12px/1.45 'JetBrains Mono', ui-monospace, monospace;
    user-select: text;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .jsonl-state {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    min-height: 180px;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .jsonl-state strong {
    color: var(--text-primary);
    font-size: 13px;
  }

  .jsonl-state.is-error {
    align-items: flex-start;
    justify-content: flex-start;
    padding: 24px;
    color: var(--error);
  }

  .jsonl-empty-icon {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--accent);
    background: var(--accent-glow);
    font: 700 17px 'JetBrains Mono', ui-monospace, monospace;
  }

  .jsonl-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: jsonl-spin 0.8s linear infinite;
  }

  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .jsonl-root .jsonl-search input:focus-visible,
  .jsonl-root .jsonl-field-filter input:focus-visible,
  .jsonl-root .jsonl-select:focus-visible,
  .jsonl-root .jsonl-pagination-center input:focus-visible {
    outline: 0;
  }

  @keyframes jsonl-spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 900px) {
    .jsonl-pagination {
      padding-top: 6px;
      padding-bottom: 6px;
    }
    .jsonl-pagination-center {
      gap: 5px;
    }
  }

  @media (max-width: 600px) {
    .jsonl-heading-bar,
    .jsonl-controls,
    .jsonl-pagination,
    .jsonl-record-list {
      padding-left: 10px;
      padding-right: 10px;
    }

    .jsonl-source-button {
      padding: 0 7px;
    }

    .jsonl-page-size-control {
      margin-left: 0;
      padding-left: 0;
      border-left: 0;
    }

    .jsonl-source-button svg {
      display: none;
    }

    .jsonl-field-filter {
      flex-basis: 100%;
      min-width: 0;
      margin-left: 0;
    }

    .jsonl-search {
      width: 100%;
      max-width: none;
      flex-basis: 100%;
    }

    .jsonl-row-actions {
      padding-right: 6px;
    }

    .jsonl-invalid-label {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .jsonl-spinner { animation: none; }
  }
</style>
