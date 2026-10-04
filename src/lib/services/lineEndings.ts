/** Normalize physical CRLF line endings, not JSON string escape sequences. */
export function normalizeLineEndings(str: string): string {
  return str.replace(/\r\n/g, '\n');
}

export function areStringsEqualNormalized(a: string, b: string): boolean {
  return a === b || normalizeLineEndings(a) === normalizeLineEndings(b);
}
