import { parseBigInt, stringifyBigInt } from '../utils/jsonBigInt.js';

/**
 * @param {{ parentType?: 'object' | 'array' }} node
 */
export function isTreeKeyEditable(node) {
  return node.parentType === 'object';
}

/**
 * @param {string} nextKey
 * @param {string[]} parentKeys
 * @param {string} [currentKey]
 */
export function validateTreeKeyName(nextKey, parentKeys, currentKey) {
  if (!nextKey) return { ok: false, error: 'Key cannot be empty' };
  if (nextKey !== currentKey && parentKeys.includes(nextKey)) {
    return { ok: false, error: 'Key already exists' };
  }
  return { ok: true };
}

/**
 * @param {Record<string, any>} pointers
 * @param {string} path
 * @param {string} nextKey
 * @param {string[]} parentKeys
 * @param {string} [currentKey]
 */
export function createTreeKeyEdit(pointers, path, nextKey, parentKeys, currentKey) {
  const validation = validateTreeKeyName(nextKey, parentKeys, currentKey);
  if (!validation.ok) return validation;

  const pointer = pointers[path];
  if (pointer?.keyStart == null || pointer?.keyEnd == null) {
    return { ok: false, error: 'Key range not found' };
  }

  return {
    ok: true,
    edit: {
      start: pointer.keyStart,
      end: pointer.keyEnd,
      text: JSON.stringify(nextKey),
    },
  };
}

/**
 * Return the source range that should be selected when a Tree node is deleted
 * from the editor. The range includes the node's key (when it has one), the
 * necessary parent separator, and any trailing JSON5 comments or commas, so
 * Monaco's native Delete/Backspace command cannot leave an orphaned separator.
 *
 * @param {string} content
 * @param {{
 *   startOffset: number
 *   endOffset: number
 *   entryStartOffset: number
 *   entryEndOffset: number
 * }} node
 * @returns {{ start: number; end: number }}
 */
export function getTreeNodeSelectionRange(content, node) {
  const start = Number.isInteger(node.entryStartOffset)
    ? node.entryStartOffset
    : node.startOffset;
  const end = Number.isInteger(node.entryEndOffset)
    ? node.entryEndOffset
    : node.endOffset;

  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    return { start: 0, end: 0 };
  }

  const trailingRange = findTrailingSourceRange(content, end);
  if (trailingRange.end > end) {
    let selectionStart = start;
    const shouldIncludePreviousSeparator = !trailingRange.hasComma
      || trailingRange.hasTrailingComma;
    if (shouldIncludePreviousSeparator) {
      const previousSignificantOffset = findPreviousSignificantOffset(content, start);
      if (previousSignificantOffset >= 0 && content[previousSignificantOffset] === ',') {
        selectionStart = previousSignificantOffset;
      }
    }
    if (trailingRange.hasLineComment) {
      selectionStart = expandToIndentedLineStart(content, selectionStart, start);
    }
    return { start: selectionStart, end: trailingRange.end };
  }

  const previousSignificantOffset = findPreviousSignificantOffset(content, start);
  if (previousSignificantOffset >= 0 && content[previousSignificantOffset] === ',') {
    return { start: previousSignificantOffset, end };
  }

  return { start, end };
}

/**
 * @param {string} content
 * @param {number} start
 * @returns {{ end: number; hasComma: boolean; hasLineComment: boolean; hasTrailingComma: boolean }}
 */
function findTrailingSourceRange(content, start) {
  let index = Math.max(0, start);
  let end = index;
  let hasComma = false;
  let hasLineComment = false;
  let lineBreakSinceToken = false;

  while (index < content.length) {
    const lineBreakLength = getLineBreakLength(content, index);
    if (lineBreakLength > 0) {
      lineBreakSinceToken = true;
      index += lineBreakLength;
      continue;
    }

    if (/\s/u.test(content[index])) {
      index += 1;
      continue;
    }

    if (content.startsWith('//', index)) {
      if (lineBreakSinceToken) break;
      const lineEnd = findLineTerminator(content, index + 2);
      hasLineComment = true;
      end = lineEnd < 0 ? content.length : lineEnd + getLineBreakLength(content, lineEnd);
      return createTrailingSourceRange(content, end, hasComma, hasLineComment);
    }

    if (content.startsWith('/*', index)) {
      const commentEnd = content.indexOf('*/', index + 2);
      if (lineBreakSinceToken) break;
      if (commentEnd < 0) {
        return createTrailingSourceRange(content, content.length, hasComma, hasLineComment);
      }
      end = commentEnd + 2;
      lineBreakSinceToken = containsLineBreak(content, index, end);
      index = end;
      continue;
    }

    if (content[index] === ',') {
      hasComma = true;
      end = index + 1;
      index = end;
      lineBreakSinceToken = false;
      continue;
    }

    break;
  }

  return createTrailingSourceRange(content, end, hasComma, hasLineComment);
}

/**
 * @param {string} content
 * @param {number} end
 * @param {boolean} hasComma
 * @param {boolean} hasLineComment
 */
function createTrailingSourceRange(content, end, hasComma, hasLineComment) {
  const nextSignificantOffset = findNextSignificantOffset(content, end);
  const nextSignificantChar = nextSignificantOffset >= 0 ? content[nextSignificantOffset] : '';

  return {
    end,
    hasComma,
    hasLineComment,
    hasTrailingComma: hasComma && (nextSignificantChar === '}' || nextSignificantChar === ']'),
  };
}

/**
 * @param {string} content
 * @param {number} start
 * @param {number} entryStart
 */
function expandToIndentedLineStart(content, start, entryStart) {
  const lineStart = findLineStart(content, entryStart);
  if (start < lineStart) return start;
  return /^\s*$/u.test(content.slice(lineStart, entryStart)) ? lineStart : start;
}

/** @param {string} content @param {number} offset */
function findLineStart(content, offset) {
  let index = Math.max(0, Math.min(content.length, offset));
  while (index > 0) {
    const previous = content[index - 1];
    if (previous === '\n' || previous === '\r' || previous === '\u2028' || previous === '\u2029') {
      break;
    }
    index -= 1;
  }
  return index;
}

/** @param {string} content @param {number} offset */
function findLineTerminator(content, offset) {
  for (let index = Math.max(0, offset); index < content.length; index += 1) {
    if (getLineBreakLength(content, index) > 0) return index;
  }
  return -1;
}

/** @param {string} content @param {number} offset */
function getLineBreakLength(content, offset) {
  const char = content[offset];
  if (char === '\r' && content[offset + 1] === '\n') return 2;
  if (char === '\r' || char === '\n' || char === '\u2028' || char === '\u2029') return 1;
  return 0;
}

/** @param {string} content @param {number} start @param {number} end */
function containsLineBreak(content, start, end) {
  const lineTerminator = findLineTerminator(content, start);
  return lineTerminator >= 0 && lineTerminator < end;
}

/**
 * Find the last source token before a boundary while ignoring strings and
 * JSON5 comments. Scanning forward avoids treating a comma inside a string or
 * comment as the parent's separator.
 *
 * @param {string} content
 * @param {number} boundary
 */
function findPreviousSignificantOffset(content, boundary) {
  const limit = Math.max(0, Math.min(content.length, boundary));
  let index = 0;
  let previous = -1;

  while (index < limit) {
    if (/\s/u.test(content[index])) {
      index += 1;
      continue;
    }

    if (content.startsWith('//', index)) {
      const lineEnd = findLineTerminator(content, index + 2);
      index = lineEnd < 0
        ? limit
        : Math.min(limit, lineEnd + getLineBreakLength(content, lineEnd));
      continue;
    }

    if (content.startsWith('/*', index)) {
      const commentEnd = content.indexOf('*/', index + 2);
      index = commentEnd < 0 ? limit : Math.min(limit, commentEnd + 2);
      continue;
    }

    if (content[index] === '"' || content[index] === "'") {
      const stringEnd = findStringEnd(content, index, content[index]);
      previous = Math.min(limit, stringEnd) - 1;
      index = Math.max(index + 1, stringEnd);
      continue;
    }

    previous = index;
    index += 1;
  }

  return previous;
}

/**
 * @param {string} content
 * @param {number} start
 */
function findNextSignificantOffset(content, start) {
  let index = Math.max(0, Math.min(content.length, start));

  while (index < content.length) {
    const lineBreakLength = getLineBreakLength(content, index);
    if (lineBreakLength > 0) {
      index += lineBreakLength;
      continue;
    }

    if (/\s/u.test(content[index])) {
      index += 1;
      continue;
    }

    if (content.startsWith('//', index)) {
      const lineEnd = findLineTerminator(content, index + 2);
      index = lineEnd < 0
        ? content.length
        : lineEnd + getLineBreakLength(content, lineEnd);
      continue;
    }

    if (content.startsWith('/*', index)) {
      const commentEnd = content.indexOf('*/', index + 2);
      index = commentEnd < 0 ? content.length : commentEnd + 2;
      continue;
    }

    return index;
  }

  return -1;
}

/**
 * @param {string} content
 * @param {number} start
 * @param {string} quote
 */
function findStringEnd(content, start, quote) {
  let index = start + 1;
  while (index < content.length) {
    if (content[index] === '\\') {
      index += 2;
      continue;
    }
    if (content[index] === quote) return index + 1;
    index += 1;
  }
  return content.length;
}

/**
 * @param {string} content
 * @param {Record<string, any>} pointers
 * @param {string} path
 * @param {unknown} value
 */
export function createTreeValueCopyText(content, pointers, path, value) {
  const pointer = pointers[path];
  const start = pointer?.valueStart;
  const end = pointer?.valueEnd;

  if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
    return content.slice(start, end);
  }

  return value === undefined ? 'null' : stringifyBigInt(value);
}

/**
 * @param {unknown} data
 * @param {string} path
 */
export function createTreePathCopyText(data, path) {
  const segments = splitPointer(path);
  if (segments.length === 0) return '';

  /** @type {any} */
  let current = data;
  let text = '';

  for (const segment of segments) {
    if (Array.isArray(current) && isArrayIndexSegment(segment)) {
      text += `[${segment}]`;
      current = current[Number(segment)];
      continue;
    }

    text += formatObjectPathSegment(segment, text.length === 0);
    current = current && typeof current === 'object'
      ? current[segment]
      : undefined;
  }

  return text;
}

/**
 * @param {string} segment
 */
function isArrayIndexSegment(segment) {
  return /^(0|[1-9]\d*)$/.test(segment);
}

/**
 * @param {string} segment
 * @param {boolean} isFirst
 */
function formatObjectPathSegment(segment, isFirst) {
  if (/^[A-Za-z_$][\w$]*$/.test(segment)) {
    return isFirst ? segment : `.${segment}`;
  }

  return `[${JSON.stringify(segment)}]`;
}

/**
 * @typedef {'before' | 'inside' | 'after'} TreeDropPosition
 * @typedef {{ data: unknown; sourcePath: string; targetPath: string; position: TreeDropPosition }} TreeMoveRequest
 * @typedef {{ ok: true; data: unknown; movedPath: string; editKey?: boolean } | { ok: false; error: string }} TreeMoveResult
 */

/**
 * @param {string} segment
 */
function decodePointerSegment(segment) {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * @param {string | number} segment
 */
function encodePointerSegment(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * @param {string} path
 */
function splitPointer(path) {
  if (path === '') return [];
  return path.split('/').slice(1).map(decodePointerSegment);
}

/**
 * @param {string[]} segments
 */
function joinPointer(segments) {
  return segments.length === 0
    ? ''
    : `/${segments.map(encodePointerSegment).join('/')}`;
}

/**
 * @param {unknown} value
 */
function cloneJsonValue(value) {
  return parseBigInt(stringifyBigInt(value));
}

/**
 * @param {unknown} value
 * @returns {'object' | 'array' | null}
 */
function getContainerType(value) {
  if (Array.isArray(value)) return 'array';
  if (value && typeof value === 'object') return 'object';
  return null;
}

/**
 * @param {unknown} data
 * @param {string[]} segments
 * @returns {any}
 */
function getAtPath(data, segments) {
  /** @type {any} */
  let current = data;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (current && typeof current === 'object') {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * @param {unknown} data
 * @param {string[]} parentSegments
 * @returns {{ container: any; type: 'object' | 'array' } | null}
 */
function getParentInfo(data, parentSegments) {
  const container = getAtPath(data, parentSegments);
  const type = getContainerType(container);
  return type ? { container, type } : null;
}

/**
 * @param {{ container: any; type: 'object' | 'array' }} parent
 * @param {string} key
 */
function hasContainerKey(parent, key) {
  if (parent.type === 'array') {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < parent.container.length;
  }
  return Object.prototype.hasOwnProperty.call(parent.container, key);
}

/**
 * @param {string} sourcePath
 * @param {string} targetPath
 */
function isSelfOrDescendantDrop(sourcePath, targetPath) {
  return targetPath === sourcePath || targetPath.startsWith(`${sourcePath}/`);
}

/**
 * @param {unknown} position
 */
function isTreeDropPosition(position) {
  return position === 'before' || position === 'inside' || position === 'after';
}

/**
 * @param {string[]} sourceParentSegments
 * @param {'object' | 'array'} sourceParentType
 * @param {string} sourceKey
 * @param {string[]} targetSegments
 */
function adjustPathAfterSourceRemoval(sourceParentSegments, sourceParentType, sourceKey, targetSegments) {
  if (sourceParentType !== 'array') return targetSegments;
  if (targetSegments.length <= sourceParentSegments.length) return targetSegments;
  if (!sourceParentSegments.every((segment, index) => targetSegments[index] === segment)) {
    return targetSegments;
  }

  const sourceIndex = Number(sourceKey);
  const targetIndexPosition = sourceParentSegments.length;
  const targetIndex = Number(targetSegments[targetIndexPosition]);
  if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex) || targetIndex <= sourceIndex) {
    return targetSegments;
  }

  const adjusted = [...targetSegments];
  adjusted[targetIndexPosition] = String(targetIndex - 1);
  return adjusted;
}

/**
 * @param {string[]} sourceSegments
 */
function createArrayElementObjectKey(sourceSegments) {
  const index = sourceSegments.at(-1);
  const parentKey = sourceSegments.at(-2);
  return parentKey == null ? `[${index}]` : `${parentKey}[${index}]`;
}

/**
 * @param {Record<string, unknown>} targetContainer
 * @param {string} baseKey
 */
function createUniqueObjectKey(targetContainer, baseKey) {
  if (!Object.prototype.hasOwnProperty.call(targetContainer, baseKey)) return baseKey;

  let index = 2;
  let nextKey = `${baseKey} ${index}`;
  while (Object.prototype.hasOwnProperty.call(targetContainer, nextKey)) {
    index += 1;
    nextKey = `${baseKey} ${index}`;
  }
  return nextKey;
}

/**
 * @param {TreeMoveRequest} request
 * @returns {TreeMoveResult}
 */
export function createTreeDragMove({ data, sourcePath, targetPath, position }) {
  if (!isTreeDropPosition(position)) return { ok: false, error: 'treeView.dragInvalidTarget' };
  if (!sourcePath || !targetPath) return { ok: false, error: 'treeView.dragInvalidTarget' };
  if (isSelfOrDescendantDrop(sourcePath, targetPath)) {
    return { ok: false, error: 'treeView.dragIntoDescendant' };
  }

  const nextData = cloneJsonValue(data);
  const sourceSegments = splitPointer(sourcePath);
  const targetSegments = splitPointer(targetPath);
  const sourceKey = sourceSegments.at(-1);
  if (sourceKey == null) return { ok: false, error: 'treeView.dragInvalidTarget' };

  const sourceParentSegments = sourceSegments.slice(0, -1);
  const sourceParent = getParentInfo(nextData, sourceParentSegments);
  if (!sourceParent) return { ok: false, error: 'treeView.dragInvalidTarget' };
  if (!hasContainerKey(sourceParent, sourceKey)) return { ok: false, error: 'treeView.dragInvalidTarget' };

  const sourceValue = sourceParent.type === 'array'
    ? sourceParent.container[Number(sourceKey)]
    : sourceParent.container[sourceKey];

  if (position === 'inside') {
    const targetContainer = getAtPath(nextData, targetSegments);
    const targetType = getContainerType(targetContainer);
    if (!targetType) {
      return { ok: false, error: 'treeView.dragInvalidTarget' };
    }

    const shouldWrapObjectFieldForArray = sourceParent.type === 'object' && targetType === 'array';
    const shouldNameArrayElementForObject = sourceParent.type === 'array' && targetType === 'object';
    if (targetType !== sourceParent.type && !shouldWrapObjectFieldForArray && !shouldNameArrayElementForObject) {
      return { ok: false, error: 'treeView.dragInvalidTarget' };
    }

    if (
      targetType === 'object' &&
      !shouldNameArrayElementForObject &&
      Object.prototype.hasOwnProperty.call(targetContainer, sourceKey)
    ) {
      return { ok: false, error: 'treeView.dragDuplicateKey' };
    }

    removeSource(sourceParent, sourceKey);
    const targetSegmentsAfterRemoval = adjustPathAfterSourceRemoval(
      sourceParentSegments,
      sourceParent.type,
      sourceKey,
      targetSegments,
    );

    if (shouldWrapObjectFieldForArray) {
      const movedPath = insertInside(
        targetContainer,
        targetType,
        sourceKey,
        { [sourceKey]: sourceValue },
        targetSegmentsAfterRemoval,
      );
      return { ok: true, data: nextData, movedPath };
    }

    if (shouldNameArrayElementForObject) {
      const nextKey = createUniqueObjectKey(
        targetContainer,
        createArrayElementObjectKey(sourceSegments),
      );
      const movedPath = insertInside(targetContainer, targetType, nextKey, sourceValue, targetSegmentsAfterRemoval);
      return { ok: true, data: nextData, movedPath, editKey: true };
    }

    const movedPath = insertInside(targetContainer, targetType, sourceKey, sourceValue, targetSegmentsAfterRemoval);
    return { ok: true, data: nextData, movedPath };
  }

  const targetKey = targetSegments.at(-1);
  if (targetKey == null) return { ok: false, error: 'treeView.dragInvalidTarget' };

  const targetParentSegments = targetSegments.slice(0, -1);
  const targetParent = getParentInfo(nextData, targetParentSegments);
  if (!targetParent || targetParent.type !== sourceParent.type) {
    return { ok: false, error: 'treeView.dragInvalidTarget' };
  }
  if (!hasContainerKey(targetParent, targetKey)) return { ok: false, error: 'treeView.dragInvalidTarget' };

  if (
    targetParent.type === 'object' &&
    sourceParent.container !== targetParent.container &&
    Object.prototype.hasOwnProperty.call(targetParent.container, sourceKey)
  ) {
    return { ok: false, error: 'treeView.dragDuplicateKey' };
  }

  const sameParent = sourceParent.container === targetParent.container;
  removeSource(sourceParent, sourceKey);
  const targetParentSegmentsAfterRemoval = adjustPathAfterSourceRemoval(
    sourceParentSegments,
    sourceParent.type,
    sourceKey,
    targetParentSegments,
  );
  const movedPath = insertBeside(
    targetParent,
    targetParentSegmentsAfterRemoval,
    sourceKey,
    sourceValue,
    targetKey,
    position,
    sameParent,
  );

  return { ok: true, data: nextData, movedPath };
}

/**
 * @param {{ container: any; type: 'object' | 'array' }} sourceParent
 * @param {string} sourceKey
 */
function removeSource(sourceParent, sourceKey) {
  if (sourceParent.type === 'array') {
    sourceParent.container.splice(Number(sourceKey), 1);
    return;
  }
  delete sourceParent.container[sourceKey];
}

/**
 * @param {any} targetContainer
 * @param {'object' | 'array'} targetType
 * @param {string} sourceKey
 * @param {unknown} sourceValue
 * @param {string[]} targetSegments
 */
function insertInside(targetContainer, targetType, sourceKey, sourceValue, targetSegments) {
  if (targetType === 'array') {
    const nextIndex = targetContainer.length;
    targetContainer.push(sourceValue);
    return joinPointer([...targetSegments, String(nextIndex)]);
  }

  targetContainer[sourceKey] = sourceValue;
  return joinPointer([...targetSegments, sourceKey]);
}

/**
 * @param {{ container: any; type: 'object' | 'array' }} targetParent
 * @param {string[]} targetParentSegments
 * @param {string} sourceKey
 * @param {unknown} sourceValue
 * @param {string} targetKey
 * @param {'before' | 'after'} position
 * @param {boolean} sameParent
 */
function insertBeside(targetParent, targetParentSegments, sourceKey, sourceValue, targetKey, position, sameParent) {
  if (targetParent.type === 'array') {
    const sourceIndex = Number(sourceKey);
    const originalTargetIndex = Number(targetKey);
    const targetIndex = sameParent && sourceIndex < originalTargetIndex
      ? originalTargetIndex - 1
      : originalTargetIndex;
    const insertionIndex = position === 'after' ? targetIndex + 1 : targetIndex;
    targetParent.container.splice(insertionIndex, 0, sourceValue);
    return joinPointer([...targetParentSegments, String(insertionIndex)]);
  }

  const entries = Object.entries(targetParent.container);
  const targetIndex = entries.findIndex(([key]) => key === targetKey);
  const insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
  /** @type {Array<[string, unknown]>} */
  const nextEntries = [
    ...entries.slice(0, insertionIndex),
    [sourceKey, sourceValue],
    ...entries.slice(insertionIndex),
  ];

  for (const key of Object.keys(targetParent.container)) {
    delete targetParent.container[key];
  }
  for (const [key, value] of nextEntries) {
    targetParent.container[key] = value;
  }

  return joinPointer([...targetParentSegments, sourceKey]);
}
