import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile, access, readdir, copyFile, chmod, symlink, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateChecksums } from '../scripts/generate-install-checksums.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { installCommand, getStateDir, resolveInstallerArgs } = require('../packages/installer/bin/jsonstudio.cjs');
const digest = text => createHash('sha256').update(text).digest('hex');
const unix = process.platform !== 'win32';

test('npm installer dispatches native scripts without evaluating user arguments', () => {
  const unixCommand = installCommand(['--version', '1.5.0', '--install-dir', "/tmp/a user's app"], 'linux', '/package');
  assert.equal(unixCommand.command, 'sh');
  assert.deepEqual(unixCommand.args, [path.join('/package', 'dist', 'install.sh'), '--version', '1.5.0', '--install-dir', "/tmp/a user's app"]);
  const windowsCommand = installCommand(['--version', '1.5.0', '--install-dir', 'C:\\App Folder'], 'win32', '/package');
  assert.equal(windowsCommand.command, 'powershell.exe');
  assert.ok(windowsCommand.args.includes('-InstallDir'));
  assert.ok(windowsCommand.args.includes('C:\\App Folder'));
  assert.ok(windowsCommand.args.includes('RemoteSigned'));
  assert.deepEqual(installCommand(['--uninstall'], 'darwin', '/package').args, [path.join('/package', 'dist', 'install.sh'), '--uninstall']);
  assert.throws(() => installCommand(['--bin-dir', 'C:\\bin'], 'win32'), /only available/);
  assert.throws(() => installCommand(['--version']), /missing value/);
  assert.throws(() => installCommand(['--unknown']), /Unknown/);
  assert.throws(() => installCommand([], 'freebsd'), /Unsupported/);
});

test('installer receipts do not depend on npm installation directory', () => {
  assert.equal(getStateDir('linux', { XDG_DATA_HOME: '/data' }, '/home'), path.join('/data', 'jsonstudio-installer'));
  assert.equal(getStateDir('darwin', {}, '/home'), path.join('/home', '.local', 'share', 'jsonstudio-installer'));
  assert.equal(getStateDir('win32', { LOCALAPPDATA: '/local' }), path.join('/local', 'JsonStudio', 'installer'));
  assert.throws(() => getStateDir('win32', {}), /LOCALAPPDATA/);
});

test('release checksums use the uploaded asset names and require all platforms', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jsonstudio-checksums-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const suffixes = ['linux_amd64.AppImage', 'macos_aarch64.app.tar.gz', 'macos_x64.app.tar.gz', 'windows_x64-setup.exe'];
  for (const suffix of suffixes) {
    await writeFile(path.join(directory, `Json Studio_1.5.0_${suffix}`), suffix);
  }
  const checksums = await generateChecksums(directory, 'v1.5.0');
  for (const suffix of suffixes) assert.ok(checksums.includes(`${digest(suffix)}  Json.Studio_1.5.0_${suffix}\n`));
  assert.equal(await readFile(path.join(directory, 'SHA256SUMS'), 'utf8'), checksums);
  await writeFile(path.join(directory, 'Json.Studio_1.5.0_linux_amd64.AppImage'), 'duplicate');
  await assert.rejects(generateChecksums(directory, 'v1.5.0'), /Duplicate/);
  await assert.rejects(generateChecksums(directory, '../../bad'), /Invalid/);
  await rm(path.join(directory, 'Json.Studio_1.5.0_linux_amd64.AppImage'));
  await rm(path.join(directory, 'Json Studio_1.5.0_windows_x64-setup.exe'));
  await assert.rejects(generateChecksums(directory, 'v1.5.0'), /Missing/);
  for (const suffix of suffixes) {
    await writeFile(path.join(directory, `Json Studio_1.5.1-beta.1_${suffix}`), suffix);
  }
  assert.match(await generateChecksums(directory, 'v1.5.1-beta.1'), /Json\.Studio_1\.5\.1-beta\.1_/);
});

async function fixture(t) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'jsonstudio-installer-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = path.join(directory, "user's home \u4e2d\u6587");
  const tools = path.join(directory, 'tools');
  const assets = path.join(directory, 'assets');
  await mkdir(tools, { recursive: true });
  await mkdir(assets);
  await mkdir(home);
  await writeFile(path.join(tools, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Linux ;; -m) echo "${TEST_ARCH:-x86_64}" ;; esac\n', { mode: 0o755 });
  await writeFile(path.join(tools, 'pgrep'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await writeFile(path.join(tools, 'curl'), `#!/bin/sh
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in -o) output=$2; shift 2 ;; https:*) url=$1; shift ;; *) shift ;; esac
done
if [ -n "\${TEST_DOWNLOAD_LOG:-}" ]; then printf '%s\\n' "$url" >> "$TEST_DOWNLOAD_LOG"; fi
cp "$TEST_ASSETS/\${url##*/}" "$output"
`, { mode: 0o755 });
  const env = {
    ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, '.local', 'share'),
    TEST_ASSETS: assets, PATH: `${tools}:${process.env.PATH}`,
    LC_ALL: 'C', LANG: 'C',
    JSONSTUDIO_ACTION: '', JSONSTUDIO_INSTALL_DIR: '', JSONSTUDIO_BIN_DIR: '', JSONSTUDIO_VERSION: '',
  };
  return {
    directory, home, tools, assets, env,
    app: path.join(env.XDG_DATA_HOME, 'jsonstudio', 'JsonStudio.AppImage'),
    state: path.join(env.XDG_DATA_HOME, 'jsonstudio-installer'),
    launcher: path.join(home, '.local', 'bin', 'jsonstudio'),
    run: (args = [], overrides = {}) => spawnSync('sh', [path.join(root, 'docs/install.sh'), ...args], {
      env: { ...env, ...overrides }, encoding: 'utf8',
    }),
    release: async (version = '1.5.0', payload = '#!/bin/sh\nprintf "started:%s" "$1"\n') => {
      const asset = `Json.Studio_${version}_linux_amd64.AppImage`;
      await writeFile(path.join(assets, asset), payload);
      await writeFile(path.join(assets, 'SHA256SUMS'), `${digest(payload)}  ${asset}\n`);
      return asset;
    },
  };
}

test('shell install, launch, update and uninstall preserve user data and handle quoted paths', { skip: !unix }, async t => {
  const f = await fixture(t);
  await f.release();
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal((await readFile(path.join(f.state, 'version'), 'utf8')).trim(), '1.5.0');
  const started = spawnSync('sh', [f.launcher, 'a file.json'], { encoding: 'utf8', env: f.env });
  assert.equal(started.status, 0, started.stderr);
  assert.equal(started.stdout, 'started:a file.json');
  const document = path.join(f.home, 'document.json');
  await writeFile(document, '{"preserved":true}');
  await f.release('1.5.1');
  const update = f.run(['--version', '1.5.1']);
  assert.equal(update.status, 0, update.stderr);
  assert.equal((await readFile(path.join(f.state, 'version'), 'utf8')).trim(), '1.5.1');
  const uninstall = f.run(['--uninstall']);
  assert.equal(uninstall.status, 0, uninstall.stderr);
  await assert.rejects(access(f.app));
  await assert.rejects(access(f.launcher));
  assert.equal(await readFile(document, 'utf8'), '{"preserved":true}');
});

test('shell refuses tampered downloads, duplicate checksums, missing checksums and unsupported architectures', { skip: !unix }, async t => {
  const f = await fixture(t);
  const asset = await f.release();
  await writeFile(path.join(f.assets, asset), 'tampered');
  assert.match(f.run().stderr, /SHA256 verification failed/);
  await assert.rejects(access(f.app));
  await f.release();
  const manifest = await readFile(path.join(f.assets, 'SHA256SUMS'), 'utf8');
  await writeFile(path.join(f.assets, 'SHA256SUMS'), manifest + manifest);
  assert.match(f.run().stderr, /exactly one checksum/);
  await rm(path.join(f.assets, 'SHA256SUMS'));
  assert.match(f.run().stderr, /checksums are unavailable/);
  assert.match(f.run([], { TEST_ARCH: 'aarch64' }).stderr, /not supported/);
  assert.match(f.run(['--version', '../../bad']).stderr, /Invalid version/);
  assert.match(f.run(['--version', '1.4.0']).stderr, /checksums are unavailable/);
});

test('latest manifest resolves to a pinned versioned asset URL', { skip: !unix }, async t => {
  const f = await fixture(t);
  const asset = await f.release();
  const log = path.join(f.directory, 'downloads');
  assert.equal(f.run([], { TEST_DOWNLOAD_LOG: log }).status, 0);
  const lines = (await readFile(log, 'utf8')).trim().split('\n');
  assert.equal(lines[0], 'https://github.com/sundegan/JsonStudio/releases/latest/download/SHA256SUMS');
  assert.equal(lines[1], `https://github.com/sundegan/JsonStudio/releases/download/v1.5.0/${asset}`);
});

test('shell preserves unmanaged files and rolls back a failed replacement', { skip: !unix }, async t => {
  const f = await fixture(t);
  await f.release();
  await mkdir(path.dirname(f.launcher), { recursive: true });
  await writeFile(f.launcher, 'unrelated command');
  assert.match(f.run().stderr, /existing command/);
  assert.equal(await readFile(f.launcher, 'utf8'), 'unrelated command');
  await rm(f.launcher);
  assert.equal(f.run().status, 0);
  const old = await readFile(f.app, 'utf8');
  await f.release('1.5.1', 'updated payload');
  await writeFile(path.join(f.tools, 'mv'), `#!/bin/sh
case "$1" in
  */.jsonstudio-install.*/Json.Studio_*) exit 42 ;;
esac
exec /bin/mv "$@"
`, { mode: 0o755 });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(f.app, 'utf8'), old);
  assert.equal((await readFile(path.join(f.state, 'version'), 'utf8')).trim(), '1.5.0');
  assert.deepEqual((await readdir(path.dirname(f.app))).filter(name => name.startsWith('.jsonstudio')), []);
});

test('shell rolls back receipts and launchers when registration fails after replacing the app', { skip: !unix }, async t => {
  const f = await fixture(t);
  await f.release();
  assert.equal(f.run().status, 0);
  const old = await readFile(f.app, 'utf8');
  const launcher = await readFile(f.launcher, 'utf8');
  await f.release('1.5.1', 'updated payload');
  await writeFile(path.join(f.tools, 'mv'), `#!/bin/sh
case "$1" in */.jsonstudio-install.*/desktop) exit 42 ;; esac
exec /bin/mv "$@"
`, { mode: 0o755 });
  assert.notEqual(f.run().status, 0);
  assert.equal(await readFile(f.app, 'utf8'), old);
  assert.equal(await readFile(f.launcher, 'utf8'), launcher);
  assert.equal((await readFile(path.join(f.state, 'version'), 'utf8')).trim(), '1.5.0');
  await assert.rejects(access(path.join(f.state, '.lock')));
});

test('shell restores the old app even if a launcher cannot be restored', { skip: !unix }, async t => {
  const f = await fixture(t);
  await f.release();
  assert.equal(f.run().status, 0);
  const old = await readFile(f.app, 'utf8');
  await f.release('1.5.1', 'updated payload');
  await writeFile(path.join(f.tools, 'mv'), `#!/bin/sh
for argument do
  case "$argument" in
    */.jsonstudio-install.*/desktop) exit 42 ;;
    */.jsonstudio-install.*/launcher.previous) exit 43 ;;
  esac
done
exec /bin/mv "$@"
`, { mode: 0o755 });
  const failed = f.run();
  assert.notEqual(failed.status, 0);
  assert.equal(await readFile(f.app, 'utf8'), old);
  assert.match(failed.stderr, /Recovery files retained/);
  const stages = (await readdir(path.dirname(f.app))).filter(name => name.startsWith('.jsonstudio-install.'));
  assert.equal(stages.length, 1);
  await access(path.join(path.dirname(f.app), stages[0], 'launcher.previous'));
  await assert.rejects(access(path.join(f.state, '.lock')));
});

test('shell keeps a custom launcher location across reinstalls and removes an old managed launcher when moved', { skip: !unix }, async t => {
  const f = await fixture(t);
  await f.release();
  const firstBin = path.join(f.home, 'custom bin');
  assert.equal(f.run(['--bin-dir', firstBin]).status, 0);
  assert.equal(f.run().status, 0);
  assert.equal((await readFile(path.join(f.state, 'bin-path'), 'utf8')).trim(), path.join(firstBin, 'jsonstudio'));
  const secondBin = path.join(f.home, 'second bin');
  const moved = f.run(['--bin-dir', secondBin]);
  assert.equal(moved.status, 0, moved.stderr);
  await assert.rejects(access(path.join(firstBin, 'jsonstudio')));
  await access(path.join(secondBin, 'jsonstudio'));
  assert.equal(f.run(['--uninstall']).status, 0);
  await assert.rejects(access(path.join(secondBin, 'jsonstudio')));
});

test('shell treats trailing slashes and directory aliases as the same installation', { skip: !unix }, async t => {
  const f = await fixture(t);
  await f.release();
  const bin = path.join(f.home, 'custom bin');
  assert.equal(f.run(['--install-dir', `${path.dirname(f.app)}///`, '--bin-dir', `${bin}///`]).status, 0);
  const alias = path.join(f.home, 'bin alias');
  await symlink(bin, alias);
  const repeated = f.run(['--bin-dir', alias]);
  assert.equal(repeated.status, 0, repeated.stderr);
  await access(path.join(bin, 'jsonstudio'));
  assert.equal((await readFile(path.join(f.state, 'bin-path'), 'utf8')).trim(), path.join(bin, 'jsonstudio'));
});

test('shell refuses to uninstall a running app', { skip: !unix }, async t => {
  const f = await fixture(t);
  await f.release();
  assert.equal(f.run().status, 0);
  await writeFile(path.join(f.tools, 'pgrep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const result = f.run(['--uninstall']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Close JsonStudio/);
  await access(f.app);
  await access(f.launcher);
});

test('shell does not recursively delete a directory in place of a Linux executable', { skip: !unix }, async t => {
  const f = await fixture(t);
  await f.release();
  assert.equal(f.run().status, 0);
  await rm(f.app);
  await mkdir(f.app);
  const unrelated = path.join(f.app, 'document.json');
  await writeFile(unrelated, 'keep');
  assert.notEqual(f.run(['--uninstall']).status, 0);
  assert.equal(await readFile(unrelated, 'utf8'), 'keep');
});

test('shell rejects concurrent installers and unmanaged menu entries without deleting either', { skip: !unix }, async t => {
  const f = await fixture(t);
  await f.release();
  const lock = path.join(f.state, '.lock');
  await mkdir(lock, { recursive: true });
  assert.match(f.run().stderr, /Another installer/);
  await access(lock);
  await rm(lock, { recursive: true });
  const desktop = path.join(f.env.XDG_DATA_HOME, 'applications', 'com.jsonstudio.app.desktop');
  await mkdir(path.dirname(desktop), { recursive: true });
  await writeFile(desktop, 'unrelated menu entry');
  assert.match(f.run().stderr, /unmanaged applications-menu/);
  assert.equal(await readFile(desktop, 'utf8'), 'unrelated menu entry');
  await rm(desktop);
  assert.match(f.run(['--version', '1.4.0']).stderr, /version mismatch/);
});

test('npm package contains the exact website installers without lifecycle download scripts', () => {
  const prepared = spawnSync(process.execPath, [path.join(root, 'packages/installer/prepare.cjs')], { encoding: 'utf8' });
  assert.equal(prepared.status, 0, prepared.stderr);
  const metadata = require('../packages/installer/package.json');
  assert.equal(metadata.scripts.postinstall, undefined);
  assert.equal(metadata.scripts.install, undefined);
  assert.equal(metadata.bin.jsonstudio, 'bin/jsonstudio.cjs');
  const help = spawnSync(process.execPath, [path.join(root, 'packages/installer/bin/jsonstudio.cjs'), '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /jsonstudio install/);
});

test('global npm launcher in ~/.local/bin is preserved during native installation', { skip: !unix }, async t => {
  const f = await fixture(t);
  await f.release();
  const ownBin = path.join(root, 'packages/installer/bin/jsonstudio.cjs');
  await mkdir(path.dirname(f.launcher), { recursive: true });
  await symlink(ownBin, f.launcher);
  const args = resolveInstallerArgs([], 'linux', f.env, f.home, ownBin);
  assert.deepEqual(args, ['--bin-dir', path.join(f.state, 'bin')]);
  const result = spawnSync(process.execPath, [ownBin, 'install'], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  await access(f.launcher);
  await access(path.join(f.state, 'bin', 'jsonstudio'));
  assert.equal((await readFile(path.join(f.state, 'bin-path'), 'utf8')).trim(), path.join(f.state, 'bin', 'jsonstudio'));
});

test('npm executes the packed installer offline and installs the native fixture', { skip: !unix }, async t => {
  const f = await fixture(t);
  await f.release();
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', f.directory], {
    cwd: path.join(root, 'packages/installer'), encoding: 'utf8',
  });
  assert.equal(packed.status, 0, packed.stderr);
  const metadata = JSON.parse(packed.stdout)[0];
  const files = metadata.files.map(file => file.path);
  assert.ok(files.includes('dist/install.sh'));
  assert.ok(files.includes('dist/install.ps1'));
  assert.ok(files.includes('bin/jsonstudio.cjs'));
  assert.ok(files.includes('LICENSE'));
  assert.ok(files.includes('README.md'));
  const result = spawnSync('npm', [
    'exec', '--offline', '--yes', '--package', path.join(f.directory, metadata.filename), '--', 'jsonstudio', 'install',
  ], { encoding: 'utf8', env: { ...f.env, npm_config_cache: path.join(f.directory, 'npm-cache') } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(f.app, 'utf8'), /started/);
  for (const name of ['install.sh', 'install.ps1']) {
    assert.equal(
      await readFile(path.join(root, 'packages/installer/dist', name), 'utf8'),
      await readFile(path.join(root, 'docs', name), 'utf8'),
    );
  }
});

test('macOS installs and removes a signed app bundle without touching system Applications', {
  skip: process.platform !== 'darwin',
}, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.tools, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Darwin ;; -m) echo x86_64 ;; esac\n', { mode: 0o755 });
  const source = path.join(f.assets, 'Json Studio.app');
  await mkdir(path.join(source, 'Contents', 'MacOS'), { recursive: true });
  await copyFile('/usr/bin/true', path.join(source, 'Contents', 'MacOS', 'jsonstudio'));
  await chmod(path.join(source, 'Contents', 'MacOS', 'jsonstudio'), 0o755);
  await writeFile(path.join(source, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.jsonstudio.app</string>
<key>CFBundleExecutable</key><string>jsonstudio</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1.5.0</string>
</dict></plist>`);
  const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', source], { encoding: 'utf8' });
  assert.equal(signed.status, 0, signed.stderr);
  const name = 'Json.Studio_1.5.0_macos_x64.app.tar.gz';
  const archive = path.join(f.assets, name);
  const packed = spawnSync('tar', ['-czf', archive, '-C', f.assets, 'Json Studio.app'], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  await writeFile(path.join(f.assets, 'SHA256SUMS'), `${digest(await readFile(archive))}  ${name}\n`);
  const installed = f.run(['--install-dir', path.join(f.home, 'Applications')]);
  assert.equal(installed.status, 0, installed.stderr);
  const app = path.join(f.home, 'Applications', 'Json Studio.app');
  await access(path.join(app, 'Contents', 'Info.plist'));
  const verified = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr);
  const removed = f.run(['--uninstall']);
  assert.equal(removed.status, 0, removed.stderr);
  await assert.rejects(access(app));
});

test('PowerShell validates install, checksum failure, version mismatch and managed uninstall', { skip: unix }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jsonstudio-powershell-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = path.join(root, 'docs/install.ps1').replaceAll("'", "''");
  const payload = 'test installer';
  const hash = digest(payload);
  const fixtureScript = path.join(directory, 'fixture.ps1');
  await writeFile(fixtureScript, `
param([string]$Mode)
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = '${directory.replaceAll("'", "''")}\\local app'
$env:JSONSTUDIO_ACTION = ''
$env:JSONSTUDIO_VERSION = ''
$env:JSONSTUDIO_INSTALL_DIR = ''
function Get-Process { return $null }
function Invoke-WebRequest {
  param($Uri, $OutFile, $TimeoutSec, [switch]$UseBasicParsing)
  if ($Uri.EndsWith('/SHA256SUMS')) {
    $hash = if ($Mode -eq 'tamper') { '0' * 64 } else { '${hash}' }
    $content = "$hash  Json.Studio_1.5.0_windows_x64-setup.exe"
    if ($Mode -eq 'bytes') { $content = [Text.Encoding]::UTF8.GetBytes($content) }
    return [PSCustomObject]@{ Content = $content }
  }
  [IO.File]::WriteAllText($OutFile, '${payload}', [Text.UTF8Encoding]::new($false))
}
function Start-Process {
  param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru)
  if ($FilePath.EndsWith('uninstall.exe')) {
    Remove-Item -LiteralPath (Split-Path $FilePath -Parent) -Recurse -Force
  } else {
    $target = $ArgumentList.Substring($ArgumentList.IndexOf('/D=') + 3)
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    [IO.File]::WriteAllText((Join-Path $target 'jsonstudio.exe'), 'app')
    [IO.File]::WriteAllText((Join-Path $target 'uninstall.exe'), 'uninstaller')
  }
  return [PSCustomObject]@{ ExitCode = 0 }
}
if ($Mode -eq 'uninstall') { & '${script}' -Uninstall }
elseif ($Mode -eq 'mismatch') { & '${script}' -Version '1.4.0' }
elseif ($Mode -eq 'relative-drive') { & '${script}' -InstallDir 'C:relative-app' }
elseif ($Mode -eq 'relative-root') { & '${script}' -InstallDir '\\relative-app' }
else { & '${script}' }
`);
  const run = mode => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', fixtureScript, mode], { encoding: 'utf8' });
  assert.notEqual(run('tamper').status, 0);
  assert.notEqual(run('mismatch').status, 0);
  for (const mode of ['relative-drive', 'relative-root']) {
    const result = run(mode);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fully qualified/);
  }
  const installed = run('install');
  assert.equal(installed.status, 0, installed.stderr);
  const byteManifest = run('bytes');
  assert.equal(byteManifest.status, 0, byteManifest.stderr);
  const receipt = path.join(directory, 'local app', 'JsonStudio', 'installer', 'app-path');
  assert.match(await readFile(receipt, 'utf8'), /jsonstudio.exe/);
  const uninstall = run('uninstall');
  assert.equal(uninstall.status, 0, uninstall.stderr);
  await assert.rejects(access(receipt));
});
