#!/usr/bin/env node
// =============================================================================
// tp-cli — Open AutoPose command line (Tier 1)
// -----------------------------------------------------------------------------
// A thin, scriptable wrapper over the tp.job/v1 contract. Offline-safe commands
// (validate/normalize/capabilities) use the dependency-free validator and a
// headless capability probe; `render` drives the real app via Playwright.
//
// Usage:
//   tp-cli validate <job.json>
//   tp-cli normalize <job.json>
//   tp-cli capabilities [--json]
//   tp-cli render <input.mp4> --job <job.json> --out <dir> [--app <html>]
//   tp-cli selftest
//   tp-cli --help
// =============================================================================

import { createRequire } from "node:module"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const spec = require(resolve(__dirname, "..", "tp-spec.js"))

const PKG_VERSION = "1.0.0"

function die(msg, code = 1) {
	process.stderr.write(String(msg) + "\n")
	process.exit(code)
}

// Minimal flag parser: collects --key value / --flag and positionals.
function parseArgs(argv) {
	const out = { _: [] }
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a.startsWith("--")) {
			const key = a.slice(2)
			const next = argv[i + 1]
			if (next === undefined || next.startsWith("--")) out[key] = true
			else { out[key] = next; i++ }
		} else out._.push(a)
	}
	return out
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"))
}

const HELP = `tp-cli ${PKG_VERSION} — Open AutoPose (tp.job/v1)

  validate <job.json>              Validate a Job Spec (offline). Exit 0 if valid.
  normalize <job.json>             Print the fully-defaulted job (offline).
  capabilities [--json]            Probe the real browser for WebGPU/WebCodecs/…
  render <input.mp4> --job <j.json> --out <dir> [--app <html>]
                                   Render controls headlessly (needs network+GPU).
  selftest                         Run the offline smoke battery.
  frames export|import|list …      FFmpeg numbered frame I/O (see tp-frames-cli).
  convert <in> --out <out>         FFmpeg transcode presets (h264/prores/webm/gif).

Global: --help, --version
Frames/convert details: node api/cli/tp-frames-cli.mjs --help`

async function cmdValidate(args) {
	const p = args._[1] || die("validate: missing <job.json>")
	const res = spec.validateJob(await readJson(p))
	process.stdout.write(JSON.stringify(res, null, 2) + "\n")
	if (!res.valid) process.exit(2)
}

async function cmdNormalize(args) {
	const p = args._[1] || die("normalize: missing <job.json>")
	process.stdout.write(JSON.stringify(spec.normalizeJob(await readJson(p)), null, 2) + "\n")
}

async function cmdCapabilities(args) {
	const { probeCapabilities } = await import("../runner/browser.mjs")
	const caps = await probeCapabilities()
	if (args.json) process.stdout.write(JSON.stringify(caps, null, 2) + "\n")
	else {
		process.stdout.write(
			`WebGPU:          ${caps.webgpu}\n` +
			`WebCodecs:       ${caps.webcodecs}\n` +
			`OffscreenCanvas: ${caps.offscreenCanvas}\n` +
			`fps estimate:    ${caps.fpsEstimate}\n` +
			`depth engines:   ${caps.depthEngines.join(", ")}\n` +
			`max characters:  ${caps.maxCharacters}\n` +
			`chromium:        ${caps.chromium || "?"}\n`,
		)
	}
}

async function cmdRender(args) {
	const input = args._[1] || die("render: missing <input.mp4>")
	const jobPath = args.job || die("render: missing --job <job.json>")
	const outDir = args.out || die("render: missing --out <dir>")
	const job = await readJson(jobPath)

	const pre = spec.validateJob(job)
	if (!pre.valid) die("render: invalid job:\n" + pre.errors.join("\n"), 2)
	for (const w of pre.warnings) process.stderr.write("warn: " + w + "\n")

	const { runJob } = await import("../runner/browser.mjs")
	const { manifest, artifacts } = await runJob({
		appPath: args.app ? resolve(args.app) : undefined,
		job,
		inputPath: resolve(input),
		onProgress: (p) => process.stderr.write(`  ${p.stage} ${Math.round(p.frac * 100)}%\r`),
	})

	await mkdir(outDir, { recursive: true })
	for (const a of artifacts) {
		await writeFile(join(outDir, a.name), Buffer.from(a.base64, "base64"))
	}
	await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2))
	process.stdout.write(
		`\nrendered ${artifacts.length} artifact(s) -> ${outDir}\n` +
		artifacts.map((a) => `  ${a.name}  ${a.kind}  ${a.sha256.slice(0, 12)}…`).join("\n") + "\n",
	)
}

async function cmdSelftest() {
	const { runSmoke } = await import("../tests/smoke.mjs")
	const ok = await runSmoke()
	process.exit(ok ? 0 : 1)
}

const COMMANDS = {
	validate: cmdValidate,
	normalize: cmdNormalize,
	capabilities: cmdCapabilities,
	render: cmdRender,
	frames: cmdFrames,
	frame: cmdFrames,
	convert: cmdConvert,
	selftest: cmdSelftest,
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	if (args.version) return void process.stdout.write(PKG_VERSION + "\n")
	const cmd = args._[0]
	if (!cmd || args.help || cmd === "help") return void process.stdout.write(HELP + "\n")
	const handler = COMMANDS[cmd] || die(`unknown command: ${cmd}\n\n${HELP}`)
	await handler(args)
}

main().catch((e) => die(e && e.stack ? e.stack : String(e)))


// FFmpeg-backed frames/convert (delegates)
async function cmdFrames(args) {
  const { runFramesCli } = await import('./tp-frames-cli.mjs')
  // rebuild argv-like: frames <sub> ...
  const argv = ['frames', ...(args._.slice(1))]
  for (const [k, v] of Object.entries(args)) {
    if (k === '_') continue
    if (v === true) argv.push('--' + k)
    else { argv.push('--' + k, String(v)) }
  }
  await runFramesCli(argv)
}
async function cmdConvert(args) {
  const { runFramesCli } = await import('./tp-frames-cli.mjs')
  const argv = ['convert', args._[1]].filter(Boolean)
  for (const [k, v] of Object.entries(args)) {
    if (k === '_') continue
    if (v === true) argv.push('--' + k)
    else { argv.push('--' + k, String(v)) }
  }
  await runFramesCli(argv)
}
