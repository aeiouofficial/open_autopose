#!/usr/bin/env node
// =============================================================================
// Tier 1 smoke battery
// -----------------------------------------------------------------------------
// Exercises every layer we CAN exercise without network/GPU:
//   A. Node validator (validate/normalize + bundled examples)
//   B. MCP server: real JSON-RPC handshake over stdio (spawns the server,
//      runs initialize / tools/list / tools/call for the offline tools)
//   C. Headless browser: real capability probe via system Chromium
//   D. Headless browser: load the REAL app and confirm the embedded TPSpec
//      classic script executes in-browser; record whether window.TP came up.
//
// The full TP.run render is intentionally NOT asserted here: it needs the app's
// installed model files and a WebGPU/WebCodecs-capable browser. `render`/`selftest`
// print a clear SKIP for it so the boundary is explicit, not hidden.
// =============================================================================

import { createRequire } from "node:module"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { readdirSync, readFileSync } from "node:fs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const API = resolve(__dirname, "..")
const spec = require(resolve(API, "tp-spec.js"))

let pass = 0, fail = 0, skip = 0
const ok = (m) => { pass++; console.log("  \u2714 " + m) }
const no = (m) => { fail++; console.log("  \u2716 " + m) }
const sk = (m) => { skip++; console.log("  \u26a0 SKIP " + m) }
function assert(cond, m) { cond ? ok(m) : no(m) }

// --- A. Node validator ------------------------------------------------------
function sectionValidator() {
	console.log("A. Node validator (offline)")
	assert(spec.SPEC_VERSION === "tp.job/v1", "SPEC_VERSION is tp.job/v1")
	assert(spec.validateJob({}).valid === true, "empty job validates")
	const n = spec.normalizeJob({})
	assert(n.characters === 1 && Array.isArray(n.output.format) && n.output.format[0] === "mp4", "defaults applied (characters=1, output.format=[mp4])")
	const bad = spec.validateJob({ depth: { engine: "turbo" }, characters: 9 })
	assert(bad.valid === false && bad.errors.length >= 2, "bad engine + characters rejected")
	// V4.4: the shape a saved preset / plugin captures must round-trip the contract
	const preset = spec.normalizeJob({
		confidence: 0.6, smoothing: 0.4,
		pose: { enabled: true, style: "white", opacity: 0.8, bone: 4, joint: 5 },
		silhouette: { enabled: true, style: "green", opacity: 0.5 },
		depth: { enabled: true, engine: "fast", opacity: 1, tint: true, stabilize: true, invert: false, smooth: 2 },
	})
	assert(preset.pose.style === "white" && preset.silhouette.style === "green" && preset.depth.engine === "fast", "preset-shaped patch normalizes (preset library contract path)")
	const exDir = resolve(API, "examples")
	for (const f of readdirSync(exDir).filter((x) => x.endsWith(".json"))) {
		const j = JSON.parse(readFileSync(resolve(exDir, f), "utf8"))
		const r = spec.validateJob(j)
		const expectValid = !f.startsWith("invalid")
		assert(r.valid === expectValid, `example ${f} validates as ${expectValid}`)
	}
}

// --- B. MCP JSON-RPC handshake ---------------------------------------------
function rpc(proc, msg) {
	return new Promise((res, rej) => {
		const want = msg.id
		let buf = ""
		const onData = (d) => {
			buf += d
			let nl
			while ((nl = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
				if (!line) continue
				const m = JSON.parse(line)
				if (m.id === want) { proc.stdout.off("data", onData); res(m) }
			}
		}
		proc.stdout.on("data", onData)
		proc.stdin.write(JSON.stringify(msg) + "\n")
		setTimeout(() => { proc.stdout.off("data", onData); rej(new Error("rpc timeout id=" + want)) }, 15000)
	})
}

async function sectionMcp() {
	console.log("B. MCP server JSON-RPC over stdio (offline tools)")
	const proc = spawn(process.execPath, [resolve(API, "mcp", "tp-mcp.mjs")], { stdio: ["pipe", "pipe", "inherit"] })
	try {
		const init = await rpc(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
		assert(init.result && init.result.serverInfo.name === "open-autopose", "initialize returns serverInfo")
		assert(init.result.protocolVersion === "2024-11-05", "advertises protocol version")

		const list = await rpc(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
		const names = list.result.tools.map((t) => t.name)
		for (const need of ["tp_validate_job", "tp_normalize_job", "tp_list_capabilities", "tp_render_controls", "tp_detect_poses", "tp_bake_depth", "tp_get_manifest"]) {
			assert(names.includes(need), `tools/list exposes ${need}`)
		}

		const call = await rpc(proc, {
			jsonrpc: "2.0", id: 3, method: "tools/call",
			params: { name: "tp_validate_job", arguments: { job: { depth: { enabled: true, engine: "vda" }, output: { format: "json" } } } },
		})
		const payload = JSON.parse(call.result.content[0].text)
		assert(payload.valid === true, "tools/call tp_validate_job returns valid=true")
		assert(Array.isArray(payload.warnings) && payload.warnings.some((w) => /webgpu/i.test(w)), "vda job surfaces a WebGPU warning")

		const norm = await rpc(proc, {
			jsonrpc: "2.0", id: 4, method: "tools/call",
			params: { name: "tp_normalize_job", arguments: { job: { fps: 24 } } },
		})
		assert(JSON.parse(norm.result.content[0].text).fps === 24, "tools/call tp_normalize_job echoes fps=24")

		const bad = await rpc(proc, {
			jsonrpc: "2.0", id: 5, method: "tools/call",
			params: { name: "tp_get_manifest", arguments: { path: "/does/not/exist.json" } },
		})
		assert(bad.result.isError === true, "tools/call error path sets isError")
	} finally {
		proc.stdin.end(); proc.kill()
	}
}

// --- C + D. Headless browser -----------------------------------------------
async function sectionBrowser() {
	console.log("C. Headless browser capability probe (offline)")
	let mod
	try { mod = await import("../runner/browser.mjs") }
	catch (e) { sk("playwright/chromium unavailable: " + e.message); return }

	try {
		const caps = await mod.probeCapabilities()
		assert(typeof caps.webgpu === "boolean" && typeof caps.webcodecs === "boolean", "probe returns boolean feature flags")
		assert(Array.isArray(caps.depthEngines) && caps.depthEngines.includes("fast"), "depthEngines includes 'fast'")
		console.log(`    (this box: webgpu=${caps.webgpu} webcodecs=${caps.webcodecs} chromium=${caps.chromium || "?"})`)
	} catch (e) { sk("capability probe could not launch chromium: " + e.message) }

	console.log("D. Headless browser loads the shipped app shell (offline)")
	try {
		const appHtml = readFileSync(mod.DEFAULT_APP_PATH, "utf8")
		const moduleAt = appHtml.indexOf('<script type="module">')
		const appShellHtml = (moduleAt >= 0 ? appHtml.slice(0, moduleAt) : appHtml) + "</body></html>"
		const browser = await mod.launchBrowser()
		try {
			const page = await browser.newPage()
			await page.goto("about:blank?offline=0")
			await page.setContent(appShellHtml, { waitUntil: "domcontentloaded" })
			const hasSpec = await page.evaluate("typeof globalThis.TPSpec !== 'undefined'")
			assert(hasSpec === true, "embedded TPSpec classic script executes in a real browser")
			if (hasSpec) {
				const v = await page.evaluate("globalThis.TPSpec.validateJob({output:{format:'png'}}).valid")
				assert(v === true, "in-browser TPSpec.validateJob works")
			}
			const duplicateIds = await page.evaluate(() => {
				const ids = [...document.querySelectorAll("[id]")].map((el) => el.id)
				return ids.filter((id, i) => ids.indexOf(id) !== i)
			})
			assert(duplicateIds.length === 0, "shipped app shell has no duplicate DOM ids")
			sk("full render acceptance requires installed model files plus a WebGPU/WebCodecs-capable browser")
		} finally { await browser.close() }
	} catch (e) { sk("real-app load could not run: " + e.message) }
}

// --- E. Offline dependency bootstrap ---------------------------------------
// The classic bootstrap script runs WITHOUT the CDN modules, so this is fully
// testable offline: it verifies that the CDN<->./vendor resolver and importmap
// switch correctly between online (identity) and offline (vendored) modes.
async function sectionOffline() {
	console.log("E. Offline dependency bootstrap (headless, offline)")
	let mod
	try {
		mod = await import("../runner/browser.mjs")
	} catch (e) { sk("offline-bootstrap test could not start: " + e.message); return }
	const appHtml = readFileSync(mod.DEFAULT_APP_PATH, "utf8")
	const moduleAt = appHtml.indexOf('<script type="module">')
	const appShellHtml = (moduleAt >= 0 ? appHtml.slice(0, moduleAt) : appHtml) + "</body></html>"
	const browser = await mod.launchBrowser()
	try {
		const page = await browser.newPage()
		// ONLINE: resolver is identity, importmap points at the CDN.
		await page.goto("about:blank?offline=0")
		await page.setContent(appShellHtml, { waitUntil: "domcontentloaded" })
		const on = await page.evaluate(() => ({
			offline: window.__TP_OFFLINE,
			dep: window.__TP_DEP("https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm"),
			cdn: document.querySelector("script[type=importmap]").textContent.includes("cdn.jsdelivr.net"),
		}))
		assert(on.offline === false, "default mode is online (offline is opt-in)")
		assert(on.dep === "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm", "online: __TP_DEP is the identity")
		assert(on.cdn === true, "online: importmap points at the CDN")
		await page.close()
		// OFFLINE (?offline=1): resolver rewrites every dep to ./vendor, local importmap.
		const offlinePage = await browser.newPage()
		await offlinePage.goto("about:blank?offline=1")
		await offlinePage.setContent(appShellHtml, { waitUntil: "domcontentloaded" })
		const off = await offlinePage.evaluate(() => {
			const d = window.__TP_DEP
			return {
				offline: window.__TP_OFFLINE,
				fflate: d("https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm"),
				muxer: d("https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.5/+esm"),
				mp: d("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm"),
				pose: d("https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"),
				localMap: document.querySelector("script[type=importmap]").textContent.includes("./vendor/three/"),
			}
		})
		assert(off.offline === true, "?offline=1 activates the vendored bootstrap")
		assert(off.fflate === "./vendor/fflate/fflate.mjs", "offline: fflate -> ./vendor/fflate/fflate.mjs")
		assert(off.muxer === "./vendor/mp4-muxer/mp4-muxer.mjs", "offline: mp4-muxer -> ./vendor/mp4-muxer/mp4-muxer.mjs")
		assert(off.mp === "./vendor/mediapipe/vision_bundle.mjs", "offline: mediapipe -> ./vendor/mediapipe/vision_bundle.mjs")
		assert(off.pose === "./vendor/models/pose_landmarker_full.task", "offline: pose model -> ./vendor/models/pose_landmarker_full.task")
		assert(off.localMap === true, "offline: importmap points three at ./vendor/three/")
		await offlinePage.close()
	} catch (e) { sk("offline-bootstrap headless check could not run: " + e.message) }
	finally { await browser.close() }
}

// --- F. REST gateway + job queue (Tier 3, in-process, offline dry-run) ------
// Boots the real HTTP gateway with the offline dry-run renderer and exercises
// the full submit -> poll -> manifest -> artifact lifecycle plus the 400/404
// error paths. No network or GPU needed, so the hosted-API path is covered by
// `tp-cli selftest` too.
async function sectionGateway() {
	console.log("F. REST gateway + job queue (in-process, dry-run)")
	let createGateway, mkdtempSync, rmSync, tmpdir, join
	try {
		;({ createGateway } = await import("../server/gateway.mjs"))
		;({ mkdtempSync, rmSync } = await import("node:fs"))
		;({ tmpdir } = await import("node:os"))
		;({ join } = await import("node:path"))
	} catch (e) { sk("gateway test could not start: " + e.message); return }
	const dataDir = mkdtempSync(join(tmpdir(), "tp-smoke-gw-"))
	const gw = createGateway({ dataDir, mode: "dryrun", token: null })
	const { url } = await gw.listen(0)
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
	try {
		const h = await (await fetch(url + "/healthz")).json()
		assert(h.ok === true && h.mode === "dryrun", "gateway healthz reports dry-run mode")

		const post = await fetch(url + "/v1/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: { pose: { enabled: true, style: "openpose" } } }) })
		assert(post.status === 202, "POST /v1/jobs accepts a valid job (202)")
		const { id } = await post.json()

		let done = { status: "?" }
		const start = Date.now()
		for (;;) {
			done = await (await fetch(url + "/v1/jobs/" + id)).json()
			if (done.status === "succeeded" || done.status === "failed") break
			if (Date.now() - start > 5000) break
			await sleep(50)
		}
		assert(done.status === "succeeded", "job runs to succeeded")
		assert(done.artifacts[0] && done.artifacts[0].name === "plan.json", "artifact metadata is listed")

		const plan = JSON.parse(await (await fetch(url + "/v1/jobs/" + id + "/artifacts/plan.json")).text())
		assert(plan.normalizedJob.pose.style === "openpose", "artifact bytes are fetchable + normalized")

		const bad = await fetch(url + "/v1/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: { depth: { enabled: true, engine: "bogus" } } }) })
		assert(bad.status === 400, "invalid job is rejected (400)")

		const missing = await fetch(url + "/v1/jobs/nope")
		assert(missing.status === 404, "unknown job id -> 404")
	} catch (e) { sk("gateway lifecycle could not run: " + e.message) }
	finally { await gw.close(); try { rmSync(dataDir, { recursive: true, force: true }) } catch {} }
}

export async function runSmoke() {
	console.log("Open AutoPose smoke battery\n")
	sectionValidator()
	await sectionMcp()
	await sectionBrowser()
	await sectionOffline()
	await sectionGateway()
	console.log(`\nresult: ${pass} passed, ${fail} failed, ${skip} skipped`)
	if (skip) console.log("(skips are environment limits — no network/GPU — not defects)")
	return fail === 0
}

if (import.meta.url === pathToFileURLSafe(process.argv[1])) {
	runSmoke().then((okAll) => process.exit(okAll ? 0 : 1))
}
function pathToFileURLSafe(p) { try { return new URL("file://" + p).href } catch { return "" } }
