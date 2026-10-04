import { invoke } from '@tauri-apps/api/core';
import {
  getTargetLanguage,
  quicktype,
  InputData,
  jsonInputForTargetLanguage,
} from 'quicktype-core';
import { parseBigInt, stringifyBigInt } from '../utils/jsonBigInt.js';

type QuicktypeLanguageName = Extract<Parameters<typeof getTargetLanguage>[0], string>;

export type CodegenLanguage =
  | 'typescript' | 'rust' | 'go' | 'java' | 'python' | 'kotlin' | 'swift' | 'csharp'
  | 'dart' | 'php' | 'ruby' | 'scala' | 'cpp' | 'javascript' | 'objectivec'
  | 'protobuf' | 'thrift';

interface LangConfig {
  id: CodegenLanguage;
  label: string;
  monacoLang: string;
  quicktypeName?: QuicktypeLanguageName;
  rendererOptions?: Record<string, string>;
}

export const CODEGEN_LANGUAGES: LangConfig[] = [
  { id: 'typescript', label: 'TypeScript', monacoLang: 'typescript', quicktypeName: 'typescript', rendererOptions: { 'just-types': 'true' } },
  { id: 'java', label: 'Java', monacoLang: 'java', quicktypeName: 'java', rendererOptions: { 'just-types': 'true' } },
  { id: 'kotlin', label: 'Kotlin', monacoLang: 'kotlin', quicktypeName: 'kotlin', rendererOptions: { framework: 'just-types' } },
  { id: 'go', label: 'Go', monacoLang: 'go', quicktypeName: 'go', rendererOptions: { 'just-types': 'true' } },
  { id: 'rust', label: 'Rust', monacoLang: 'rust', quicktypeName: 'rust', rendererOptions: { density: 'dense', visibility: 'public' } },
  { id: 'python', label: 'Python', monacoLang: 'python', quicktypeName: 'python', rendererOptions: { 'just-types': 'true', 'python-version': '3.6' } },
  { id: 'swift', label: 'Swift', monacoLang: 'swift', quicktypeName: 'swift', rendererOptions: { 'just-types': 'true' } },
  { id: 'csharp', label: 'C#', monacoLang: 'csharp', quicktypeName: 'csharp', rendererOptions: { features: 'just-types' } },
  { id: 'dart', label: 'Dart', monacoLang: 'dart', quicktypeName: 'dart', rendererOptions: { 'just-types': 'true' } },
  { id: 'php', label: 'PHP', monacoLang: 'php', quicktypeName: 'php', rendererOptions: { 'just-types': 'true' } },
  { id: 'ruby', label: 'Ruby', monacoLang: 'ruby', quicktypeName: 'ruby', rendererOptions: { 'just-types': 'true' } },
  { id: 'scala', label: 'Scala', monacoLang: 'scala', quicktypeName: 'scala3', rendererOptions: { framework: 'just-types' } },
  { id: 'cpp', label: 'C++', monacoLang: 'cpp', quicktypeName: 'cpp', rendererOptions: { 'just-types': 'true' } },
  { id: 'javascript', label: 'JavaScript', monacoLang: 'javascript', quicktypeName: 'javascript' },
  { id: 'objectivec', label: 'Objective-C', monacoLang: 'objective-c', quicktypeName: 'objc', rendererOptions: { 'just-types': 'true' } },
  { id: 'protobuf', label: 'Protobuf', monacoLang: 'protobuf' },
  { id: 'thrift', label: 'Thrift', monacoLang: 'plaintext' },
];

const BACKEND_ONLY_LANGUAGES = new Set<CodegenLanguage>(['protobuf', 'thrift']);
const ARBITRARY_INTEGER_LANGUAGES = new Set<CodegenLanguage>(['python', 'ruby']);
const FLOAT_ONLY_LANGUAGES = new Set<CodegenLanguage>(['typescript', 'javascript']);
const MAX_I64 = 9223372036854775807n;
const MIN_I64 = -9223372036854775808n;

const ROOT_ARRAY_MARKER = 'jsonstudio:root-array';

function markRootArray(parsed: unknown, language: CodegenLanguage, generated: string): string {
  if (!Array.isArray(parsed)) return generated;

  const comment = language === 'python' || language === 'ruby'
    ? `# ${ROOT_ARRAY_MARKER}`
    : `// ${ROOT_ARRAY_MARKER}`;
  if (language === 'php' && generated.startsWith('<?php')) {
    const body = generated.slice('<?php'.length).replace(/^\n/, '');
    return `<?php\n${comment}\n${body}`;
  }
  return `${comment}\n${generated}`;
}

function jsonInputForCodegenLanguage(qtLang: QuicktypeLanguageName) {
  if (qtLang !== 'php') {
    return jsonInputForTargetLanguage(qtLang);
  }

  const phpLanguage = getTargetLanguage(qtLang);
  const defaultRecognizer = phpLanguage.dateTimeRecognizer;
  const phpInputLanguage = Object.create(phpLanguage);
  Object.defineProperty(phpInputLanguage, 'dateTimeRecognizer', {
    configurable: true,
    value: {
      // quicktype-core's PHP renderer does not support its `date` type.
      isDate: () => false,
      isDateTime: (value: string) => defaultRecognizer.isDateTime(value),
      isTime: (value: string) => defaultRecognizer.isTime(value),
    },
  });
  return jsonInputForTargetLanguage(phpInputLanguage);
}

function phpCompatibilitySample(value: unknown): { value: unknown; changed: boolean } {
  if (value === null) {
    return { value: {}, changed: true };
  }

  if (Array.isArray(value)) {
    const allNull = value.length > 0 && value.every(item => item === null);
    if (allNull) {
      return { value: value.map(() => ({})), changed: true };
    }

    let changed = false;
    const next = value.map(item => {
      if (item === null) return item;
      const result = phpCompatibilitySample(item);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }

  if (typeof value === 'object') {
    let changed = false;
    const next = Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const result = phpCompatibilitySample(item);
        changed ||= result.changed;
        return [key, result.value];
      }),
    );
    return { value: next, changed };
  }

  return { value, changed: false };
}

function phpInputSamples(content: string): string[] {
  try {
    const parsed = parseBigInt(content) as unknown;
    const compatibility = phpCompatibilitySample(parsed);
    if (!compatibility.changed) return [content];
    return [content, stringifyBigInt(compatibility.value)];
  } catch (_) {
    return [content];
  }
}

async function quicktypeCode(
  content: string,
  className: string,
  qtLang: QuicktypeLanguageName,
  samples: string[],
  rendererOptions: Record<string, string>,
  preserveIntegerTypes = false,
): Promise<string> {
  const jsonInput = jsonInputForCodegenLanguage(qtLang);
  await jsonInput.addSource({ name: className, samples });

  const inputData = new InputData();
  inputData.addInput(jsonInput);

  try {
    const result = await quicktype({
      inputData,
      lang: qtLang,
      rendererOptions,
      ...(preserveIntegerTypes ? { combineClasses: false, inferMaps: false } : {}),
    });
    return result.lines.join('\n');
  } catch (error) {
    if (qtLang !== 'php' || samples.length === 1) throw error;

    // PHP cannot render every union introduced by the compatibility sample.
    // Retain the original input as a stable fallback for those mixed shapes.
    return quicktypeCode(content, className, qtLang, [content], rendererOptions, preserveIntegerTypes);
  }
}

const REVERSE_SUPPORTED_LANGUAGES = new Set<CodegenLanguage>([
  'typescript', 'java', 'kotlin', 'go', 'rust', 'python', 'swift', 'csharp',
  'dart', 'php', 'ruby', 'scala', 'cpp', 'protobuf', 'thrift',
  'javascript', 'objectivec',
]);

export function supportsReverse(language: CodegenLanguage): boolean {
  return REVERSE_SUPPORTED_LANGUAGES.has(language);
}

export async function generateCode(
  content: string,
  language: CodegenLanguage,
  className: string,
): Promise<string> {
  const parsed = parseBigInt(content);
  let hasBigInteger = false;
  const integerPaths = new Set<string>();
  const fractionalPaths = new Set<string>();
  function prepareIntegerSamples(value: unknown, path: (string | null)[] = []): unknown {
    if (typeof value === 'bigint') {
      hasBigInteger = true;
      integerPaths.add(JSON.stringify(path));
      if (FLOAT_ONLY_LANGUAGES.has(language)) {
        throw new Error(`${language} generation uses number types that cannot represent this integer exactly`);
      }
      if (!ARBITRARY_INTEGER_LANGUAGES.has(language) && (value < MIN_I64 || value > MAX_I64)) {
        throw new Error(`${language} generation cannot represent this integer in its signed 64-bit type`);
      }
      // Inference only: a small integer prevents quicktype from misclassifying huge integers as doubles.
      return 1;
    }
    if (typeof value === 'number' && !Number.isInteger(value)) fractionalPaths.add(JSON.stringify(path));
    if (Array.isArray(value)) return value.map(item => prepareIntegerSamples(item, [...path, null]));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key, prepareIntegerSamples(item, [...path, key]),
      ]));
    }
    return value;
  }
  const inferenceData = prepareIntegerSamples(parsed);
  if ([...integerPaths].some(path => fractionalPaths.has(path))) {
    throw new Error('Code generation cannot preserve large integers in a field mixed with fractional numbers');
  }
  if (BACKEND_ONLY_LANGUAGES.has(language)) {
    return await invoke<string>('json_to_code', { content: stringifyBigInt(parsed), language, className });
  }

  const langConfig = CODEGEN_LANGUAGES.find(l => l.id === language);
  if (!langConfig?.quicktypeName) {
    throw new Error(`Unsupported language: ${language}`);
  }

  const qtLang = langConfig.quicktypeName;
  const inferenceContent = hasBigInteger ? stringifyBigInt(inferenceData) : content;
  const samples = qtLang === 'php' ? phpInputSamples(inferenceContent) : [inferenceContent];
  const generated = await quicktypeCode(
    inferenceContent,
    className,
    qtLang,
    samples,
    langConfig.rendererOptions || {},
    hasBigInteger,
  );
  return markRootArray(parsed, language, generated);
}

export async function codeToJson(
  content: string,
  language: CodegenLanguage,
): Promise<string> {
  return await invoke<string>('code_to_json', { content, language });
}
