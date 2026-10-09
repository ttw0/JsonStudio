import {
  findJsonStringLiteralAt,
  formatEmbeddedJson,
  parseEmbeddedJsonString,
} from './embeddedJson.js';

// Scanning a huge minified line on every cursor move would stall typing.
const MAX_SCANNED_LINE_LENGTH = 1_000_000;
const registeredInstances = new WeakSet();

/**
 * Offer a code action that expands the JSON string value under the cursor.
 *
 * @param {typeof import('monaco-editor')} monaco
 * @param {() => string} getTitle
 */
export function registerEmbeddedJsonCodeActions(monaco, getTitle) {
  if (registeredInstances.has(monaco)) return;

  for (const language of ['json', 'json5']) {
    monaco.languages.registerCodeActionProvider(language, {
      provideCodeActions(model, range) {
        const edit = createEmbeddedJsonCodeActionEdit(model, range.startLineNumber, range.startColumn);
        if (!edit) return { actions: [], dispose() {} };
        return {
          actions: [{
            title: getTitle(),
            kind: 'refactor.rewrite',
            isPreferred: true,
            edit: {
              edits: [{
                resource: model.uri,
                versionId: model.getVersionId(),
                textEdit: edit,
              }],
            },
          }],
          dispose() {},
        };
      },
    }, { providedCodeActionKinds: ['refactor.rewrite'] });
  }
  registeredInstances.add(monaco);
}

/**
 * @param {{
 *   getLineContent(lineNumber: number): string
 *   getLineLength(lineNumber: number): number
 *   getLineCount(): number
 *   getEOL(): string
 *   getOptions(): { insertSpaces: boolean; indentSize: number }
 * }} model
 * @param {number} lineNumber
 * @param {number} column One-based Monaco column.
 */
export function createEmbeddedJsonCodeActionEdit(model, lineNumber, column) {
  if (model.getLineLength(lineNumber) > MAX_SCANNED_LINE_LENGTH) return null;
  const line = model.getLineContent(lineNumber);
  const literal = findJsonStringLiteralAt(line, column - 1);
  if (!literal || literal.isKey) return null;

  const parsed = parseEmbeddedJsonString(literal.value);
  if (!parsed.ok) return null;

  const options = model.getOptions();
  const text = formatEmbeddedJson(parsed.value, {
    lineBreak: model.getLineCount() > 1 ? model.getEOL() : '',
    indentUnit: options.insertSpaces ? ' '.repeat(options.indentSize) : '\t',
    lineIndent: /^[ \t]*/u.exec(line)?.[0] ?? '',
  });
  return {
    range: {
      startLineNumber: lineNumber,
      startColumn: literal.start + 1,
      endLineNumber: lineNumber,
      endColumn: literal.end + 1,
    },
    text,
  };
}
