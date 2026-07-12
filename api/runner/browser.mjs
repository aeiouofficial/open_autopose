// =============================================================================
// Open AutoPose — headless browser runner (Tier 1)
// -----------------------------------------------------------------------------
// Shared Playwright bridge used by BOTH the CLI (`tp-cli`) and the MCP server
// (`tp-mcp`). It never re-implements any pipeline logic: it loads the exact
// same locally hosted app the human uses and drives the `window.TP` API.
// There is one source of truth for rendering - the browser app.
//
// Two entry points:
//   probeCapabilities()  - loads a tiny dependency-free probe page to detect
//                           browser features. Works fully offline.
//   runJob()             - serves the built/vendored app on a temporary
//                           loopback HTTP host and calls window.TP.run().
// =============================================================================

import { chromium } from "playwright"
import { readFile, stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve, basename, join, extname, sep } from "node:path"
import { createReadStream, existsSync, readdirSync } from "node:fs"
import http from "node:http"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Prefer an explicit override, then common system-browser locations. If no
// system browser is found, omit executablePath so Playwright can use its own
// installed Chromium.
function resolveChromiumPath() {
	if (process.env.TP_CHROMIUM) return process.env.TP_CHROMIUM
	const env = process.env
	const candidates = [
		"/usr/bin/chromium", "/usr/bin/chromium-browser",
		"/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
		"/usr/local/bin/chromium", "/usr/local/bin/google-chrome",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		...(env.PROGRAMFILES ? [join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")] : []),
		...(env["PROGRAMFILES(X86)"] ? [join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")] : []),
		...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")] : []),
	]
	return candidates.find((candidate) => existsSync(candidate)) || null
}
export const CHROMIUM_PATH = resolveChromiumPath()

// Resolve the shipped app HTML relative to this file (api/runner/../..).
// Prefer TP_APP, then the production build, then the development public app.
function resolveDefaultAppPath() {
	if (process.env.TP_APP) return resolve(process.env.TP_APP)
	const root = resolve(__dirname, "..", "..")
	const prefer = [
		join(root, "dist", "app.html"),
		join(root, "public", "app.html"),
		join(root, "OpenAutoPose_v1.0.0.html"),
	]
	for (const path of prefer) if (existsSync(path)) return path
	try {
		const hits = readdirSync(root)
			.filter((f) => /^Open AutoPose.*\.html$/i.test(f) && !/Guide/i.test(f))
			.sort()
			.reverse()
		if (hits[0]) return join(root, hits[0])
	} catch {}
	return join(root, "public", "app.html")
}
export const DEFAULT_APP_PATH = resolveDefaultAppPath()

const APP_MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".wasm": "application/wasm",
	".onnx": "application/octet-stream",
	".task": "application/octet-stream",
	".mp4": "video/mp4",
}

async function startLocalAppServer(appPath) {
	const root = dirname(resolve(appPath))
	const server = http.createServer(async (req, res) => {
		try {
			const url = new URL(req.url || "/", "http://127.0.0.1")
			const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || basename(appPath)
			const file = resolve(root, rel)
			if (file !== root && !file.startsWith(root + sep)) {
				res.writeHead(400); return res.end("bad path")
			}
			const info = await stat(file)
			if (!info.isFile()) throw new Error("not a file")
			res.writeHead(200, {
				"content-type": APP_MIME[extname(file).toLowerCase()] || "application/octet-stream",
				"content-length": info.size,
				"cache-control": "no-cache",
				"cross-origin-opener-policy": "same-origin",
				"cross-origin-embedder-policy": "require-corp",
			})
			createReadStream(file).pipe(res)
		} catch {
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
			res.end("not found")
		}
	})
	await new Promise((resolveListen, rejectListen) => {
		server.once("error", rejectListen)
		server.listen(0, "127.0.0.1", resolveListen)
	})
	const address = server.address()
	return {
		url: `http://127.0.0.1:${address.port}/${encodeURIComponent(basename(appPath))}?offline=1`,
		close: () => new Promise((resolveClose) => server.close(resolveClose)),
	}
}

const LAUNCH_ARGS = [
	"--no-sandbox",
	"--enable-unsafe-webgpu",
	"--enable-features=Vulkan,WebGPU",
	"--use-angle=swiftshader", // best-effort software fallback when no GPU
]

export async function launchBrowser() {
	return chromium.launch({
		...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
		headless: true,
		args: LAUNCH_ARGS,
	})
}

// The capability check mirrors window.TP.capabilities() but runs on a bare page
// so it does not depend on the full app runtime. Safe offline.
const CAP_PROBE = `(async () => {
	let webgpu = false
	try { webgpu = !!(navigator.gpu && (await navigator.gpu.requestAdapter())) } catch {}
	const webcodecs = typeof VideoEncoder !== 'undefined'
	const offscreenCanvas = typeof OffscreenCanvas !== 'undefined'
	const fpsEstimate = typeof HTMLVideoElement !== 'undefined'
		&& 'requestVideoFrameCallback' in HTMLVideoElement.prototype
	return {
		webgpu, webcodecs, offscreenCanvas, fpsEstimate,
		depthEngines: ['fast', ...(webgpu ? ['vda'] : [])],
		poseModel: 'mediapipe_pose_landmarker_full',
		maxCharacters: 5,
	}
})()`

/**
 * Probe the real browser for the features the pipeline needs. Offline-safe.
 * @returns {Promise<object>} capability snapshot (same shape as TP.capabilities()).
 */
export async function probeCapabilities() {
	const browser = await launchBrowser()
	try {
		const page = await browser.newPage()
		await page.setContent("<!doctype html><meta charset=utf-8><title>tp probe</title>")
		const caps = await page.evaluate(CAP_PROBE)
		caps.chromium = (await browser.version?.()) || undefined
		return caps
	} finally {
		await browser.close()
	}
}

/**
 * Run a Job Spec through the real app in a headless browser.
 *
 * @param {object}   opts
 * @param {string}  [opts.appPath]    Path to the shipped Open AutoPose HTML app.
 * @param {object}   opts.job         A tp.job/v1 spec (raw; the app normalizes).
 * @param {string}  [opts.inputPath]  Local video file to feed as the source.
 * @param {(p:{stage:string,frac:number})=>void} [opts.onProgress]
 * @param {number}  [opts.readyTimeoutMs]  How long to wait for window.TP.
 * @returns {Promise<{manifest:object, artifacts:Array<{name,kind,mime,sha256,base64}>}>}
 */
export async function runJob({
	appPath = DEFAULT_APP_PATH,
	job,
	inputPath,
	onProgress,
	readyTimeoutMs = 45000,
} = {}) {
	if (!job || typeof job !== "object") throw new Error("runJob: `job` object is required")

	const browser = await launchBrowser()
	const appServer = await startLocalAppServer(appPath)
	const consoleErrors = []
	try {
		const page = await browser.newPage()
		page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()) })
		page.on("pageerror", (e) => consoleErrors.push(String(e)))

		if (typeof onProgress === "function") {
			await page.exposeFunction("__tpOnProgress", (p) => onProgress(p))
		}

		await page.goto(appServer.url, { waitUntil: "load" })

		// The app's window.TP only initializes after its ES modules (MediaPipe,
		// ONNX and muxer) finish loading from the local vendor tree. If startup
		// stalls or a required file is missing, fail loudly with the captured reason.
		try {
			await page.waitForFunction("typeof window.TP !== 'undefined'", null, { timeout: readyTimeoutMs })
		} catch {
			const tpSpecPresent = await page.evaluate("typeof globalThis.TPSpec !== 'undefined'")
			throw new Error(
				`window.TP never initialized from the local vendored app. ` +
				`TPSpec present: ${tpSpecPresent}. Run npm run setup to install offline models and ` +
				`verify the browser supports the requested GPU features. Console errors:\n` +
				consoleErrors.slice(0, 8).join("\n"),
			)
		}

		// Feed the source video as a File, reconstructed inside the page.
		let fileArg = null
		if (inputPath) {
			const buf = await readFile(inputPath)
			fileArg = { base64: buf.toString("base64"), name: basename(inputPath), type: "video/mp4" }
		}

		const result = await page.evaluate(async ({ job, fileArg }) => {
			const opts = { download: false }
			if (typeof window.__tpOnProgress === "function") opts.onProgress = (p) => window.__tpOnProgress(p)
			if (fileArg) {
				const bin = atob(fileArg.base64)
				const arr = new Uint8Array(bin.length)
				for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
				opts.file = new File([arr], fileArg.name, { type: fileArg.type })
			}
			const { manifest, artifacts } = await window.TP.run(job, opts)
			// Blobs cannot cross the Node boundary — hand back base64 bytes.
			const out = []
			for (const a of artifacts) {
				const bytes = new Uint8Array(await a.blob.arrayBuffer())
				let bin = ""
				const CH = 0x8000
				for (let i = 0; i < bytes.length; i += CH) {
					bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
				}
				out.push({ name: a.name, kind: a.kind, mime: a.mime, sha256: a.sha256, base64: btoa(bin) })
			}
			return { manifest, artifacts: out }
		}, { job, fileArg })

		return result
	} finally {
		await appServer.close()
		await browser.close()
	}
}
