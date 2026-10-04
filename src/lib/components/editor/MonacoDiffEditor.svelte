<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import type * as Monaco from 'monaco-editor';
  import { ArrowLeft } from '@lucide/svelte';
  import { initMonaco } from '$lib/services/monaco';
  import { unescapeString } from '$lib/services/json';
  import { formatJsonText } from '$lib/services/json5Format.js';
  import { normalizePastedJson } from '$lib/services/diffPasteNormalize.js';
  import { registerMonacoThemes, type EditorTheme } from '$lib/config/monacoThemes';
  import { t } from '$lib/i18n';
  import { normalizeLineEndings } from '$lib/services/lineEndings';
  import { minifyNumericJson } from '$lib/services/numericNormalize.js';

  type DiffSide = 'original' | 'modified';
  const paneEditorOptions: Monaco.editor.IEditorOptions = {
    glyphMargin: false,
    lineDecorationsWidth: 16,
    lineNumbersMinChars: 3,
    folding: true,
    showFoldingControls: 'always',
    foldingStrategy: 'auto',
  };

  let {
    originalValue = '',
    modifiedValue = '',
    language = 'json',
    theme = 'vs',
    readOnly = false,
    fontSize = 13,
    lineHeight = 20,
    tabSize = 2,
    onOriginalChange = (_value: string) => {},
    onModifiedChange = (_value: string) => {},
    onDiffUpdate = (_changes: Monaco.editor.ILineChange[]) => {},
    onActiveSideChange = (_side: DiffSide) => {},
    onEditorReady = () => {},
    onExit = () => {},
  }: {
    originalValue?: string;
    modifiedValue?: string;
    language?: string;
    theme?: EditorTheme;
    readOnly?: boolean;
    fontSize?: number;
    lineHeight?: number;
    tabSize?: number;
    onOriginalChange?: (value: string) => void;
    onModifiedChange?: (value: string) => void;
    onDiffUpdate?: (changes: Monaco.editor.ILineChange[]) => void;
    onActiveSideChange?: (side: DiffSide) => void;
    onEditorReady?: () => void;
    onExit?: () => void;
  } = $props();

  let container: HTMLDivElement;
  let diffEditor = $state.raw<Monaco.editor.IStandaloneDiffEditor | null>(null);
  let monaco = $state<typeof Monaco | null>(null);
  let originalModel = $state.raw<Monaco.editor.ITextModel | null>(null);
  let modifiedModel = $state.raw<Monaco.editor.ITextModel | null>(null);
  let isSyncingOriginal = false;
  let isSyncingModified = false;
  let originalPasteTimer: ReturnType<typeof setTimeout> | null = null;
  let modifiedPasteTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSide = $state<DiffSide>('original');
  let originalPaneWidth = $state<number | null>(null);
  const paneFoldingDisposables: Monaco.IDisposable[] = [];
  let destroyed = false;

  function setActiveSide(side: DiffSide) {
    if (activeSide === side) return;
    activeSide = side;
    onActiveSideChange(side);
  }

  function getActiveEditor(): Monaco.editor.IStandaloneCodeEditor | null {
    if (!diffEditor) return null;
    return activeSide === 'original'
      ? diffEditor.getOriginalEditor()
      : diffEditor.getModifiedEditor();
  }

  export function getValue(): string {
    return getActiveEditor()?.getValue() || '';
  }

  export function setValue(value: string) {
    const model = getActiveEditor()?.getModel();
    if (!model) return;
    model.pushStackElement();
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text: value }],
      () => null,
    );
    model.pushStackElement();
  }

  export function minify(): string {
    const value = getValue();
    return minifyNumericJson(value);
  }

  export function foldAll() {
    void getActiveEditor()?.getAction('editor.foldAll')?.run();
  }

  export function unfoldAll() {
    void getActiveEditor()?.getAction('editor.unfoldAll')?.run();
  }

  export function getEditorInstance() {
    return getActiveEditor();
  }

  $effect(() => {
    // Always read originalValue first to establish dependency tracking
    // (avoid short-circuit evaluation preventing dependency registration)
    const currentOriginalValue = originalValue;
    if (originalModel && normalizeLineEndings(currentOriginalValue) !== normalizeLineEndings(originalModel.getValue())) {
      isSyncingOriginal = true;
      // Use pushEditOperations to preserve undo history
      const fullRange = originalModel.getFullModelRange();
      originalModel.pushEditOperations(
        [],
        [{ range: fullRange, text: currentOriginalValue }],
        () => null
      );
      isSyncingOriginal = false;
    }
  });

  $effect(() => {
    // Always read modifiedValue first to establish dependency tracking
    // (avoid short-circuit evaluation preventing dependency registration)
    const currentModifiedValue = modifiedValue;
    if (modifiedModel && normalizeLineEndings(currentModifiedValue) !== normalizeLineEndings(modifiedModel.getValue())) {
      isSyncingModified = true;
      // Use pushEditOperations to preserve undo history
      const fullRange = modifiedModel.getFullModelRange();
      modifiedModel.pushEditOperations(
        [],
        [{ range: fullRange, text: currentModifiedValue }],
        () => null
      );
      isSyncingModified = false;
    }
  });

  $effect(() => {
    if (monaco && theme) {
      monaco.editor.setTheme(theme);
    }
  });

  $effect(() => {
    const instance = diffEditor;
    const options = {
      readOnly,
      originalEditable: !readOnly,
      fontSize,
      lineHeight,
    };
    // Monaco callbacks must not add focus/active-side state to this effect's dependencies.
    if (instance) untrack(() => {
      const viewState = instance.saveViewState();
      instance.updateOptions(options);
      if (viewState) instance.restoreViewState(viewState);
    });
  });

  $effect(() => {
    if (originalModel) {
      originalModel.updateOptions({
        tabSize,
        indentSize: tabSize,
        insertSpaces: true,
      });
    }
    if (modifiedModel) {
      modifiedModel.updateOptions({
        tabSize,
        indentSize: tabSize,
        insertSpaces: true,
      });
    }
  });

  onMount(async () => {
    const monacoInstance = await initMonaco();
    if (destroyed || !container.isConnected) return;
    monaco = monacoInstance;

    registerMonacoThemes(monacoInstance);
    (monacoInstance.languages.json as any).jsonDefaults?.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      schemaValidation: 'error',
      enableSchemaRequest: false,
    });

    const createdDiffEditor = monacoInstance.editor.createDiffEditor(container, {
      ...paneEditorOptions,
      theme,
      automaticLayout: true,
      readOnly,
      originalEditable: !readOnly,
      renderSideBySide: true,
      minimap: { enabled: false },
      renderOverviewRuler: false,
      renderGutterMenu: false,
      renderMarginRevertIcon: false,
      scrollBeyondLastLine: false,
      fontSize,
      lineHeight,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
      contextmenu: false,
      renderIndicators: false,
    });

    diffEditor = createdDiffEditor;
    const createdOriginalModel = monacoInstance.editor.createModel(originalValue, language);
    const createdModifiedModel = monacoInstance.editor.createModel(modifiedValue, language);
    originalModel = createdOriginalModel;
    modifiedModel = createdModifiedModel;
    createdDiffEditor.setModel({ original: createdOriginalModel, modified: createdModifiedModel });

    const originalEditor = createdDiffEditor.getOriginalEditor();
    const modifiedEditor = createdDiffEditor.getModifiedEditor();
    for (const pane of [originalEditor, modifiedEditor]) {
      // Monaco disables pane folding whenever Diff options or layout modes change.
      paneFoldingDisposables.push(pane.onDidChangeConfiguration(event => {
        if (
          event.hasChanged(monacoInstance.editor.EditorOption.folding) &&
          !pane.getOption(monacoInstance.editor.EditorOption.folding)
        ) {
          pane.updateOptions(paneEditorOptions);
        }
      }));
      pane.updateOptions(paneEditorOptions);
    }
    originalEditor.onMouseDown(() => setActiveSide('original'));
    modifiedEditor.onMouseDown(() => setActiveSide('modified'));
    originalEditor.onDidFocusEditorText(() => setActiveSide('original'));
    modifiedEditor.onDidFocusEditorText(() => setActiveSide('modified'));
    originalPaneWidth = originalEditor.getLayoutInfo().width;
    originalEditor.onDidLayoutChange(({ width }) => {
      originalPaneWidth = width;
    });
    originalEditor.onDidPaste(() => {
      schedulePasteNormalize(createdOriginalModel, 'original');
    });
    modifiedEditor.onDidPaste(() => {
      schedulePasteNormalize(createdModifiedModel, 'modified');
    });

    createdOriginalModel.onDidChangeContent(() => {
      if (isSyncingOriginal) return;
      onOriginalChange(createdOriginalModel.getValue());
    });

    createdModifiedModel.onDidChangeContent(() => {
      if (isSyncingModified) return;
      onModifiedChange(createdModifiedModel.getValue());
    });

    createdDiffEditor.onDidUpdateDiff(() => {
      const changes = createdDiffEditor.getLineChanges() || [];
      onDiffUpdate(changes);
    });

    onActiveSideChange(activeSide);
    onEditorReady();
  });

  onDestroy(() => {
    destroyed = true;
    if (originalPasteTimer) clearTimeout(originalPasteTimer);
    if (modifiedPasteTimer) clearTimeout(modifiedPasteTimer);
    for (const disposable of paneFoldingDisposables) disposable.dispose();
    diffEditor?.dispose();
    originalModel?.dispose();
    modifiedModel?.dispose();
  });

  function schedulePasteNormalize(model: Monaco.editor.ITextModel, side: 'original' | 'modified') {
    if (side === 'original' && originalPasteTimer) clearTimeout(originalPasteTimer);
    if (side === 'modified' && modifiedPasteTimer) clearTimeout(modifiedPasteTimer);

    const timer = setTimeout(async () => {
      if (destroyed || model.isDisposed()) return;
      const sourceValue = model.getValue();
      const normalized = await normalizePastedJson(sourceValue, {
        format: value => formatJsonText(value, tabSize),
        unescape: unescapeString,
      });
      if (
        destroyed ||
        model.isDisposed() ||
        !normalized ||
        normalizeLineEndings(normalized) === normalizeLineEndings(sourceValue) ||
        normalizeLineEndings(model.getValue()) !== normalizeLineEndings(sourceValue)
      ) {
        return;
      }

      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: normalized }],
        () => null
      );
    }, 100);

    if (side === 'original') {
      originalPasteTimer = timer;
    } else {
      modifiedPasteTimer = timer;
    }
  }
</script>

<div class="diff-editor-shell">
  <div
    class="diff-pane-headers"
    style:grid-template-columns={originalPaneWidth === null
      ? undefined
      : `${originalPaneWidth}px minmax(0, 1fr)`}
  >
    <div class="diff-pane-header" class:is-active={activeSide === 'original'}>
      <div class="diff-pane-header-left">
        <button
          class="diff-back-btn"
          onclick={onExit}
          aria-label={$t('toolbar.exitDiff')}
          title={$t('toolbar.exitDiff')}
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <span class="diff-pane-badge">JSON A</span>
      </div>
      <span class="diff-pane-indicator" aria-hidden="true"></span>
    </div>
    <div class="diff-pane-header" class:is-active={activeSide === 'modified'}>
      <span class="diff-pane-badge">JSON B</span>
      <span class="diff-pane-indicator" aria-hidden="true"></span>
    </div>
  </div>
  <div bind:this={container} class="diff-editor-container"></div>
</div>

<style>
  .diff-editor-shell {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 200px;
    background: var(--bg-primary);
  }

  .diff-pane-headers {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    flex: 0 0 40px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .diff-pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
    padding: 6px 12px;
  }

  .diff-pane-header + .diff-pane-header {
    border-left: 1px solid var(--border);
  }

  .diff-pane-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .diff-back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .diff-back-btn:hover {
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
  }

  .diff-pane-badge {
    flex-shrink: 0;
    padding: 4px 8px;
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .diff-pane-indicator {
    width: 6px;
    height: 6px;
    flex: 0 0 6px;
    border-radius: 50%;
    background: var(--text-tertiary);
  }

  .diff-pane-header.is-active .diff-pane-indicator {
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .diff-editor-container {
    width: 100%;
    flex: 1 1 auto;
    min-height: 0;
  }

</style>
