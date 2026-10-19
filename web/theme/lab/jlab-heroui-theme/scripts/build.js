#!/usr/bin/env node
/* ML Box — build the prebuilt labextension bundle for @mlbox/jlab-heroui-theme.
 *
 * Equivalent to `jupyter labextension build .`:
 *   1. locates a JupyterLab "core" path (either $JLAB_CORE_PATH, or the
 *      `staging` directory of an installed python jupyterlab>=4), and
 *   2. runs @jupyterlab/builder's build-labextension CLI with it.
 *
 * Why not rely on `jupyter labextension build`: that shell command is not
 * available in every environment; `build-labextension` is the same mechanism
 * the python command uses. In the PZ2JH image build use whatever is easiest —
 * `./build.sh` (or `npm run build`) — or the pip route documented in README.
 *
 * Also normalizes the `load` path written into labextension/package.json
 * (backslashes would be invalid when served on Linux).
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkgRoot = path.resolve(__dirname, '..');

function findCorePath() {
  if (process.env.JLAB_CORE_PATH) {
    return path.resolve(process.env.JLAB_CORE_PATH);
  }
  // Ask pip-installed jupyterlab for its staging directory.
  const probe = spawnSync('python', [
    '-c',
    'import jupyterlab, os; print(os.path.join(os.path.dirname(jupyterlab.__file__), "staging"))'
  ], { encoding: 'utf8' });
  if (probe.status === 0) {
    const staging = probe.stdout.trim();
    if (staging && fs.existsSync(path.join(staging, 'package.json'))) {
      return staging;
    }
  }
  console.error(
    'ERROR: no JupyterLab core found.\n' +
      'Set JLAB_CORE_PATH to the share/jupyter/lab/staging directory of an\n' +
      'installed jupyterlab>=4 (e.g. run: pip install "jupyterlab>=4").'
  );
  process.exit(1);
}

// --------------------------------------------------------------------------

const watch = process.argv.includes('--watch');
const corePath = findCorePath();

console.log(`==> core path: ${corePath}`);

const cli = require.resolve('@jupyterlab/builder/lib/build-labextension.js');
const args = ['.', '--core-path', corePath];
if (watch) {
  args.push('--watch');
}

try {
  execFileSync(process.execPath, [cli, ...args], {
    stdio: 'inherit',
    cwd: pkgRoot
  });
} catch (err) {
  process.exit(err.status || 1);
}

if (!watch) {
  // Normalize the load path for Linux containers.
  const built = path.join(pkgRoot, 'labextension', 'package.json');
  const data = JSON.parse(fs.readFileSync(built, 'utf8'));
  let changed = false;
  if (data.jupyterlab && data.jupyterlab._build) {
    for (const key of Object.keys(data.jupyterlab._build)) {
      const value = data.jupyterlab._build[key];
      if (typeof value === 'string' && value.includes('\\')) {
        data.jupyterlab._build[key] = value.replace(/\\/g, '/');
        changed = true;
      }
    }
  }
  if (changed) {
    fs.writeFileSync(built, JSON.stringify(data, null, 2) + '\n');
    console.log('==> normalized labextension/package.json load paths');
  }
  console.log(`==> done: ${path.join(pkgRoot, 'labextension')}`);
}
