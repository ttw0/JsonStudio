const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
for (const name of ['install.sh', 'install.ps1']) {
  fs.copyFileSync(path.join(root, 'docs', name), path.join(__dirname, 'dist', name));
}
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(__dirname, 'LICENSE'));
