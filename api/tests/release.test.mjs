import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const api = resolve(here, '..')
const root = resolve(api, '..')
const appPath = resolve(root, 'public', 'app.html')
const VERSION = '1.0.0'

test('all executable release surfaces advertise one version', async () => {
  const rootPkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const apiPkg = JSON.parse(await readFile(resolve(api, 'package.json'), 'utf8'))
  const cli = await readFile(resolve(api, 'cli/tp-cli.mjs'), 'utf8')
  const mcp = await readFile(resolve(api, 'mcp/tp-mcp.mjs'), 'utf8')
  const gateway = await readFile(resolve(api, 'server/gateway.mjs'), 'utf8')
  const runtime = await readFile(resolve(api, 'tp-runtime.js'), 'utf8')
  const app = await readFile(appPath, 'utf8')

  assert.equal(rootPkg.version, VERSION)
  assert.equal(apiPkg.version, VERSION)
  assert.match(cli, new RegExp(`PKG_VERSION = ["']${VERSION}["']`))
  assert.match(mcp, new RegExp(`version: ["']${VERSION}["']`))
  assert.match(gateway, new RegExp(`GATEWAY_VERSION = ["']${VERSION}["']`))
  assert.match(runtime, /TP_VERSION = ["']v1\.0\.0["']/)
  assert.match(app, /TP_VERSION = ["']v1\.0\.0["']/)
})

test('documented CLI frame routes are registered', async () => {
  const cli = await readFile(resolve(api, 'cli/tp-cli.mjs'), 'utf8')
  assert.match(cli, /frames:\s*cmdFrames/)
  assert.match(cli, /convert:\s*cmdConvert/)
})

test('local Vite release files exist', async () => {
  for (const rel of ['README.md', 'INSTALL.md', 'LICENSE', 'package.json', 'package-lock.json', 'vite.config.mjs', 'public/app.html']) {
    const data = await readFile(resolve(root, rel))
    assert.ok(data.length > 10, `${rel} should be non-empty`)
  }
})

test('classic enhancement layers are wired to the module runtime', async () => {
  const app = await readFile(appPath, 'utf8')
  assert.match(app, /window\.__tpCore = tpCoreBridge/)
  assert.match(app, /window\.tpStatus = status/)
  assert.match(app, /Object\.assign\(window, tpCoreBridge\)/)
  for (const name of ['frameIndexNow', 'tpPoseModelTier', 'tpReloadPoseModel', 'tpCaptureCurrentPatch', 'tpApplyPatch', 'getDepthCanvas']) {
    assert.match(app, new RegExp(`\\b${name}\\b`), `core bridge includes ${name}`)
  }
  assert.equal((app.match(/const status = window\.tpStatus;/g) || []).length, 4)
})

test('npm scripts provide local dev, build, preview, and static hosting', async () => {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  for (const name of ['dev', 'build', 'preview', 'serve', 'start', 'setup', 'test:all']) {
    assert.equal(typeof pkg.scripts[name], 'string', `missing npm script ${name}`)
  }
  assert.match(pkg.scripts.dev, /vite/)
  assert.match(pkg.scripts.build, /vite build/)
  assert.match(pkg.scripts.serve, /serve-dist\.mjs/)
})

test('offline runtime uses exact npm packages and a generated manifest', async () => {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    assert.doesNotMatch(version, /^[~^]/, `${name} must be exact, got ${version}`)
  }
  const prepare = await readFile(resolve(root, 'scripts', 'prepare-vendor.mjs'), 'utf8')
  assert.match(prepare, /runtime-manifest\.json/)
  assert.match(prepare, /package-lock\.json|exact npm packages/)
})

test('gateway binds to loopback by default and rejects unsafe public binding', async () => {
  const gateway = await readFile(resolve(api, 'server/gateway.mjs'), 'utf8')
  const cli = await readFile(resolve(api, 'server/tp-gateway.mjs'), 'utf8')
  assert.match(gateway, /TP_HOST \|\| "127\.0\.0\.1"/)
  assert.match(cli, /Refusing non-loopback gateway binding without TP_API_TOKEN/)
})

test('local runner serves the vendored app over loopback instead of file URLs', async () => {
  const runner = await readFile(resolve(api, 'runner', 'browser.mjs'), 'utf8')
  assert.match(runner, /startLocalAppServer/)
  assert.match(runner, /\?offline=1/)
  assert.doesNotMatch(runner, /pathToFileURL\(appPath\)/)
})

test('publish docs and launch surfaces contain no Docker requirement or old app filename', async () => {
  const files = [
    'README.md', 'INSTALL.md', 'vendor/README.md',
    'api/API.md', 'api/MCP.md', 'api/plugins/README.md',
    'Start_App.bat', 'Start_App.sh',
  ]
  for (const rel of files) {
    const data = await readFile(resolve(root, rel), 'utf8')
    assert.doesNotMatch(data, /OpenAutoPose_v5\.1\.1\.html/)
    assert.doesNotMatch(data, /docker compose|docker build/i)
  }
})

test('smoke browser launch is portable', async () => {
  const smoke = await readFile(resolve(api, 'tests', 'smoke.mjs'), 'utf8')
  assert.doesNotMatch(smoke, /executablePath:\s*process\.env\.TP_CHROMIUM/)
  assert.match(smoke, /launchBrowser\(\)/)
  assert.match(smoke, /page\.setContent\(appShellHtml/)
})

test('sequence import does not write temporary files into the source folder', async () => {
  const io = await readFile(resolve(api, 'ffmpeg-io.mjs'), 'utf8')
  assert.doesNotMatch(io, /join\(dir, ['"]\._tp_concat\.txt['"]\)/)
  assert.match(io, /mkdtemp\(join\(tmpdir\(\), ['"]tp-concat-/)
  assert.match(io, /rm\(tempDir, \{ recursive: true, force: true \}\)/)
})
