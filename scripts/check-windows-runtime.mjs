import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dynamicRuntime = /^(?:(?:vcruntime|msvcp|msvcr|concrt|vccorlib)\d\w*|ucrtbased)\.dll$/i;

export function verifyWindowsRuntimeImports(output) {
  const dependencies = [...new Set(
    output.split(/\r?\n/)
      .map((line) => line.trim().match(/^(?:DLL Name:\s*)?([^\s]+\.dll)$/i)?.[1])
      .filter(Boolean)
  )];

  if (dependencies.length === 0) {
    throw new Error('No DLL imports found; Windows runtime verification did not run successfully.');
  }

  const missingRuntime = dependencies.filter((name) => dynamicRuntime.test(name));
  if (missingRuntime.length > 0) {
    throw new Error(
      `The app requires an external Visual C++ runtime: ${missingRuntime.join(', ')}. `
      + 'Build with target-feature=+crt-static before distributing it.'
    );
  }

  return dependencies;
}

function findDumpbin() {
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe'
  );
  const candidates = execFileSync(vswhere, [
    '-latest', '-products', '*',
    '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-find', 'VC\\Tools\\MSVC\\**\\bin\\Hostx64\\x64\\dumpbin.exe',
  ], { encoding: 'utf8', timeout: 30_000 });
  const dumpbin = candidates.split(/\r?\n/).map((line) => line.trim())
    .find((candidate) => candidate && existsSync(candidate));
  if (!dumpbin) {
    throw new Error('dumpbin.exe was not found in the Visual Studio C++ build tools.');
  }
  return dumpbin;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const binaryPath = process.argv[2];
    if (!binaryPath || !existsSync(binaryPath)) {
      throw new Error('Provide the path to the built Windows application executable.');
    }
    if (process.platform !== 'win32') {
      throw new Error('This check requires Windows with Visual Studio C++ build tools.');
    }

    const imports = execFileSync(findDumpbin(), ['/NOLOGO', '/DEPENDENTS', binaryPath], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const dependencies = verifyWindowsRuntimeImports(imports);
    console.log(`Verified ${binaryPath}: no external Visual C++ runtime imports.`);
    console.log(dependencies.join('\n'));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
