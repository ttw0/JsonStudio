import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { verifyWindowsRuntimeImports } from '../scripts/check-windows-runtime.mjs';

test('Windows MSVC builds statically link the C/C++ runtime', () => {
  const config = readFileSync(new URL('../.cargo/config.toml', import.meta.url), 'utf8');
  assert.match(
    config,
    /\[target\.'cfg\(all\(target_os = "windows", target_env = "msvc"\)\)'\]\s*(?:#[^\n]*\n\s*)*rustflags = \["-C", "target-feature=\+crt-static"\]/
  );
});

test('runtime verification accepts OS-provided DLLs and CRLF dumpbin output', () => {
  const output = [
    'Dump of file jsonstudio.exe',
    '',
    '  Image has the following dependencies:',
    '',
    '    KERNEL32.dll',
    '    USER32.dll',
    '    api-ms-win-crt-runtime-l1-1-0.dll',
    '    ucrtbase.dll',
    '',
    '  Summary',
    '        1000 .data',
  ].join('\r\n');

  assert.deepEqual(verifyWindowsRuntimeImports(output), [
    'KERNEL32.dll', 'USER32.dll', 'api-ms-win-crt-runtime-l1-1-0.dll', 'ucrtbase.dll',
  ]);
});

test('runtime verification rejects the missing DLLs in the v1.5.0 executable', () => {
  assert.throws(
    () => verifyWindowsRuntimeImports('    KERNEL32.dll\n    VCRUNTIME140.dll\n    VCRUNTIME140_1.dll\n'),
    /external Visual C\+\+ runtime: VCRUNTIME140\.dll, VCRUNTIME140_1\.dll/
  );
});

test('runtime verification also rejects C++ and debug runtime variants', () => {
  for (const dependency of [
    'vcruntime140_1.dll', 'VCRUNTIME140D.dll', 'MSVCP140.dll', 'msvcp140_2.dll',
    'MSVCP140_ATOMIC_WAIT.dll', 'MSVCR120.dll', 'CONCRT140.dll', 'VCCORLIB140.dll',
    'ucrtbased.dll',
  ]) {
    assert.throws(
      () => verifyWindowsRuntimeImports(`    KERNEL32.dll\n    ${dependency}\n`),
      /external Visual C\+\+ runtime/
    );
  }
});

test('runtime verification inspects delay-loaded dependencies too', () => {
  assert.throws(
    () => verifyWindowsRuntimeImports([
      '  Image has the following dependencies:',
      '    KERNEL32.dll',
      '  Image has the following delay load dependencies:',
      '    VCRUNTIME140_1.dll',
    ].join('\n')),
    /VCRUNTIME140_1\.dll/
  );
});

test('runtime verification supports llvm-objdump output for artifact investigation', () => {
  assert.throws(
    () => verifyWindowsRuntimeImports('    DLL Name: kernel32.dll\n    DLL Name: VCRUNTIME140_1.dll\n'),
    /VCRUNTIME140_1\.dll/
  );
});

test('runtime verification fails closed when the dependency tool produced no imports', () => {
  for (const output of ['', 'fatal error: binary not found', 'Summary\n1000 .text']) {
    assert.throws(() => verifyWindowsRuntimeImports(output), /No DLL imports found/);
  }
});

test('every Windows packaging workflow verifies runtime imports after building', () => {
  for (const workflow of ['build-release.yml', 'build-preview.yml', 'build-test.yml']) {
    const source = readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8');
    const buildPosition = source.indexOf('pnpm tauri build');
    const checkPosition = source.indexOf('node scripts/check-windows-runtime.mjs');
    assert.ok(buildPosition > 0 && checkPosition > buildPosition, workflow);
  }
});
