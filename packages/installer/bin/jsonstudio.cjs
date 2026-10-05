#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function getStateDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') {
    if (!env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is required.');
    return path.join(env.LOCALAPPDATA, 'JsonStudio', 'installer');
  }
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'jsonstudio-installer');
}

function installCommand(args, platform = process.platform, packageDir = path.resolve(__dirname, '..')) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) throw new Error(`Unsupported system: ${platform}`);
  const translated = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--uninstall') {
      translated.push(platform === 'win32' ? '-Uninstall' : flag);
      continue;
    }
    const names = { '--version': '-Version', '--install-dir': '-InstallDir', '--bin-dir': null };
    if (!Object.hasOwn(names, flag) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(`Unknown option or missing value: ${flag}`);
    }
    if (platform === 'win32' && !names[flag]) throw new Error(`${flag} is only available on macOS/Linux.`);
    translated.push(platform === 'win32' ? names[flag] : flag, args[++index]);
  }
  if (platform === 'win32') {
    const script = path.join(packageDir, 'dist', 'install.ps1');
    return {
      command: 'powershell.exe',
      script,
      args: ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', script, ...translated],
    };
  }
  const script = path.join(packageDir, 'dist', 'install.sh');
  return { command: 'sh', script, args: [script, ...translated] };
}

function resolveInstallerArgs(args, platform = process.platform, env = process.env, home = os.homedir(), ownBin = __filename) {
  if (platform === 'win32' || args.includes('--bin-dir') || env.JSONSTUDIO_BIN_DIR) return args;
  const defaultLauncher = path.join(home, '.local', 'bin', 'jsonstudio');
  if (fs.existsSync(defaultLauncher) && fs.realpathSync(defaultLauncher) === fs.realpathSync(ownBin)) {
    return [...args, '--bin-dir', path.join(getStateDir(platform, env, home), 'bin')];
  }
  return args;
}

function runInstaller(args) {
  const invocation = installCommand(resolveInstallerArgs(args));
  if (!fs.existsSync(invocation.script)) {
    throw new Error('Installer scripts are missing. From the source checkout, run: node packages/installer/prepare.cjs');
  }
  const result = spawnSync(invocation.command, invocation.args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Installer failed${result.signal ? ` (${result.signal})` : ` (exit ${result.status})`}.`);
}

function launch(args) {
  const receipt = path.join(getStateDir(), 'app-path');
  if (!fs.existsSync(receipt)) runInstaller([]);
  const appPath = fs.readFileSync(receipt, 'utf8').trim();
  if (!path.isAbsolute(appPath) || !fs.existsSync(appPath)) throw new Error('The app is missing. Run: jsonstudio install');
  const command = process.platform === 'darwin' ? '/usr/bin/open' : appPath;
  const launchArgs = process.platform === 'darwin' ? ['-a', appPath, '--args', ...args] : args;
  const child = spawn(command, launchArgs, { detached: true, stdio: ['ignore', 'ignore', 'inherit'], windowsHide: false });
  child.on('error', error => { console.error(`JsonStudio: ${error.message}`); process.exitCode = 1; });
  child.unref();
}

function main(args) {
  if (args[0] === '--help' || args[0] === '-h') {
    console.log('JsonStudio desktop installer\n\njsonstudio install [--version VERSION] [--install-dir PATH] [--bin-dir PATH]\njsonstudio uninstall\njsonstudio [FILE ...]\njsonstudio --version\n\nNo install-time scripts are used. Running jsonstudio installs the app on first launch.');
  } else if (args[0] === '--version') {
    console.log(`JsonStudio installer ${require('../package.json').version}`);
  } else if (args[0] === 'install') {
    runInstaller(args.slice(1));
  } else if (args[0] === 'uninstall') {
    if (args.length !== 1) throw new Error('Usage: jsonstudio uninstall');
    runInstaller(['--uninstall']);
  } else {
    if (args.some(arg => arg.startsWith('-'))) throw new Error('Unknown option. Run: jsonstudio --help');
    launch(args);
  }
}

module.exports = { getStateDir, installCommand, resolveInstallerArgs, main };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`JsonStudio: ${error.message}`); process.exitCode = 1; }
}
