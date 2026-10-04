const registeredInstances = new WeakSet();
const commentKind = { value: 'comment' };
const regionKind = { value: 'region' };

/** @param {typeof import('monaco-editor')} monaco */
export function registerJsonFoldingProviders(monaco) {
  if (registeredInstances.has(monaco)) return;

  // Use one structural provider in every JSON editor, independent of the JSON worker.
  for (const language of ['json', 'json5']) {
    monaco.languages.registerFoldingRangeProvider({ language, exclusive: true }, {
      provideFoldingRanges: getJson5FoldingRanges,
    });
  }
  registeredInstances.add(monaco);
}

/**
 * @param {{ getLineCount(): number; getLineContent(lineNumber: number): string }} model
 * @returns {import('monaco-editor').languages.FoldingRange[]}
 */
export function getJson5FoldingRanges(model) {
  /** @type {import('monaco-editor').languages.FoldingRange[]} */
  const ranges = [];
  const stack = [];
  /** @type {number[]} */
  const regionStack = [];
  let quote = '';
  let escaped = false;
  let blockCommentStart = 0;
  const lineCount = model.getLineCount();

  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
    const line = model.getLineContent(lineNumber);
    let inLineComment = false;

    for (let column = 0; column < line.length; column += 1) {
      const char = line[column];
      const next = line[column + 1];

      if (inLineComment) {
        if (char === '\u2028' || char === '\u2029') inLineComment = false;
        continue;
      }
      if (blockCommentStart) {
        if (char === '*' && next === '/') {
          if (blockCommentStart < lineNumber) {
            const end = line.slice(column + 2).trim() ? lineNumber - 1 : lineNumber;
            if (blockCommentStart < end) {
              ranges.push({ start: blockCommentStart, end, kind: commentKind });
            }
          }
          blockCommentStart = 0;
          column += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          quote = '';
        }
        continue;
      }

      if (char === '/' && next === '/') {
        const marker = /^\/\/[ \t]*#(region|endregion)\b/.exec(line.slice(column));
        if (marker?.[1] === 'region') {
          regionStack.push(lineNumber);
        } else if (marker?.[1] === 'endregion') {
          const start = regionStack.pop();
          const end = lineNumber - 1;
          if (start !== undefined && start < end) {
            ranges.push({ start, end, kind: regionKind });
          }
        }
        inLineComment = true;
        column += 1;
        continue;
      }
      if (char === '/' && next === '*') {
        blockCommentStart = lineNumber;
        column += 1;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '{' || char === '[') {
        stack.push({ char, line: lineNumber });
        continue;
      }
      if (char === '}' || char === ']') {
        const opener = stack.at(-1);
        if (opener?.char === (char === '}' ? '{' : '[')) {
          stack.pop();
          // Folding is line-based: keep the closing line visible so siblings or
          // enclosing delimiters on that same line are never hidden with the child.
          const end = lineNumber - 1;
          if (opener.line < end) {
            ranges.push({ start: opener.line, end });
          }
        }
      }
    }

    if (lineNumber < lineCount && quote) {
      if (escaped) {
        escaped = false;
      } else {
        quote = '';
      }
    }
  }

  // Monaco keeps only the first range for a start line. Prefer the enclosing scope,
  // not the child that closed first, when multiple brackets opened on that line.
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  return ranges.filter((range, index) => index === 0 || range.start !== ranges[index - 1].start);
}
