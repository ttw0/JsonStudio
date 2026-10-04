import BigNumber from 'bignumber.js';
import { parseBigInt, parseDecimalLiteral, stringifyBigInt } from '../utils/jsonBigInt.js';

const MAX_SCHEMA_BYTES = 5 * 1024 * 1024;
const SCHEMA_SIZE_ERROR = 'Schema response exceeds the 5 MiB limit';

/**
 * @param {string} value
 * @returns {string | null}
 */
function parseRemoteHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * @param {string} jsonContent
 * @returns {string | null}
 */
export function getRemoteSchemaUrl(jsonContent) {
  const data = parseBigInt(jsonContent);
  const schemaUrl = data && typeof data === 'object' && !Array.isArray(data) ? data.$schema : null;

  return typeof schemaUrl === 'string' ? parseRemoteHttpsUrl(schemaUrl) : null;
}

/**
 * @param {string} schemaUrl
 * @param {{ fetchImpl?: typeof fetch; signal?: AbortSignal }} [options]
 */
export async function fetchRemoteSchema(schemaUrl, options = {}) {
  const { fetchImpl = fetch, signal } = options;
  const normalizedUrl = parseRemoteHttpsUrl(schemaUrl);
  if (!normalizedUrl) {
    throw new Error('Only HTTPS schema URLs can be fetched automatically');
  }

  const nativeSchema = await fetchSchemaWithTauri(normalizedUrl);
  if (nativeSchema !== null) return nativeSchema;

  const response = await fetchImpl(normalizedUrl, {
    headers: { Accept: 'application/schema+json, application/json' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch schema (${response.status} ${response.statusText})`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_SCHEMA_BYTES) {
    throw new Error(SCHEMA_SIZE_ERROR);
  }

  const schemaText = await response.text();
  if (new TextEncoder().encode(schemaText).byteLength > MAX_SCHEMA_BYTES) {
    throw new Error(SCHEMA_SIZE_ERROR);
  }

  const schema = parseBigInt(schemaText, parseDecimalLiteral);
  if (schema === null || Array.isArray(schema) || BigNumber.isBigNumber(schema) ||
    (typeof schema !== 'object' && typeof schema !== 'boolean')) {
    throw new Error('Fetched schema must be a JSON object or boolean');
  }

  return stringifyBigInt(schema, null, 2);
}

/**
 * @param {string} schemaUrl
 * @returns {Promise<string | null>}
 */
async function fetchSchemaWithTauri(schemaUrl) {
  let tauri;
  try {
    tauri = await import('@tauri-apps/api/core');
  } catch {
    return null;
  }

  if (!tauri.isTauri()) return null;
  return tauri.invoke('fetch_remote_schema', { schemaUrl });
}
