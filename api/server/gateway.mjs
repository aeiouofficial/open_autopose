// =============================================================================
// Open AutoPose — REST gateway (Tier 3)
// -----------------------------------------------------------------------------
// A zero-dependency HTTP gateway over the job queue. Built only on Node core
// (`http`, `crypto`, `fs`) so it runs anywhere Node runs — no framework, no
// npm install. It fronts the exact same headless runner the CLI uses; there is
// still a single source of truth for rendering (the app).
//
// Endpoints (all JSON unless noted):
//   GET    /healthz                         -> { ok, version, mode, stats }
//   GET    /v1/capabilities                 -> real browser capability probe
//   POST   /v1/jobs         { job, input? } -> 202 { id, status, links }
//   GET    /v1/jobs                         -> { jobs: [...] }
//   GET    /v1/jobs/:id                     -> job view
//   GET    /v1/jobs/:id/manifest            -> tp.manifest/v1
//   GET    /v1/jobs/:id/artifacts           -> { artifacts: [...] }
//   GET    /v1/jobs/:id/artifacts/:name     -> raw bytes (artifact mime)
//   POST   /v1/jobs/:id/cancel              -> job view
//   DELETE /v1/jobs/:id                     -> delete a terminal job and its local artifacts
//
// Auth: if TP_API_TOKEN is set, every /v1/* call must send
//   Authorization: Bearer <token>
// =============================================================================

import http from "node:http"
import { createRequire } from "node:module"
import { createReadStream } from "node:fs"
import { writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve, join } from "node:path"
import { randomUUID } from "node:crypto"
import { createQueue } from "./queue.mjs"
import { makeRenderer } from "./renderer.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const spec = require(resolve(__dirname, "..", "tp-spec.js"))

export const GATEWAY_VERSION = "1.0.0"
const MAX_BODY = 512 * 1024 * 1024 // 512 MB cap (base64 video uploads)

function send(res, code, obj, headers = {}) {
	const body = Buffer.from(JSON.stringify(obj, null, 2))
	res.writeHead(code, {
		"content-type": "application/json; charset=utf-8",
		"content-length": body.length,
		...(res._tpCorsHeaders || {}),
		...headers,
	})
	res.end(body)
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = []
		let size = 0
		req.on("data", (c) => {
			size += c.length
			if (size > MAX_BODY) { reject(new Error("payload too large")); req.destroy() }
			else chunks.push(c)
		})
		req.on("end", () => resolve(Buffer.concat(chunks)))
		req.on("error", reject)
	})
}

/**
 * Create (but do not start) a gateway. Returns { server, queue, listen, close, url }.
 * @param {object} opts
 * @param {string} [opts.dataDir]      Where jobs/artifacts are persisted.
 * @param {number} [opts.concurrency] Worker pool size.
 * @param {string} [opts.mode]        'real' | 'dryrun' (default from env).
 * @param {string} [opts.appPath]     Path to the app HTML (real mode).
 * @param {string} [opts.token]       Bearer token (default from TP_API_TOKEN).
 * @param {string[]} [opts.corsOrigins] Allowed browser origins.
 * @param {boolean} [opts.allowInputPath] Allow trusted clients to submit local file paths.
 */
export function createGateway(opts = {}) {
	const dataDir = opts.dataDir || resolve(__dirname, "..", "..", ".tp-gateway-data")
	const concurrency = opts.concurrency || Number(process.env.TP_CONCURRENCY || 1)
	const { mode, handler } = makeRenderer({ mode: opts.mode, appPath: opts.appPath })
	const token = opts.token !== undefined ? opts.token : process.env.TP_API_TOKEN || null
	const allowInputPath = opts.allowInputPath !== undefined ? !!opts.allowInputPath : process.env.TP_ALLOW_INPUT_PATH === "1"
	const defaultOrigins = [
		"http://127.0.0.1:5173", "http://localhost:5173",
		"http://127.0.0.1:4173", "http://localhost:4173",
	]
	const configuredOrigins = opts.corsOrigins || (process.env.TP_CORS_ORIGINS ? process.env.TP_CORS_ORIGINS.split(",") : defaultOrigins)
	const allowedOrigins = new Set(configuredOrigins.map((value) => String(value).trim()).filter(Boolean))
	const uploadsDir = join(dataDir, "uploads")
	mkdirSync(uploadsDir, { recursive: true })

	const queue = createQueue({ dataDir, concurrency, handler })

	function authed(req) {
		if (!token) return true
		const h = req.headers["authorization"] || ""
		return h === `Bearer ${token}`
	}

	const server = http.createServer(async (req, res) => {
		try {
			const requestOrigin = typeof req.headers.origin === "string" ? req.headers.origin : null
			if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
				return send(res, 403, { error: "origin not allowed" })
			}
			res._tpCorsHeaders = requestOrigin ? {
				"access-control-allow-origin": requestOrigin,
				"access-control-allow-headers": "authorization, content-type",
				"access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
				"vary": "Origin",
			} : {}
			const url = new URL(req.url, "http://localhost")
			const path = url.pathname
			const method = req.method || "GET"

			if (method === "OPTIONS") return send(res, 204, {})
			if (path === "/healthz" && method === "GET")
				return send(res, 200, { ok: true, version: GATEWAY_VERSION, spec: "tp.job/v1", mode, stats: queue.stats() })

			// Everything under /v1 requires auth (when a token is configured).
			if (path.startsWith("/v1") && !authed(req)) return send(res, 401, { error: "unauthorized" })

			if (path === "/v1/capabilities" && method === "GET") {
				try {
					const { probeCapabilities } = await import("../runner/browser.mjs")
					return send(res, 200, await probeCapabilities())
				} catch (e) { return send(res, 503, { error: "capability probe failed", detail: String(e && e.message || e) }) }
			}

			if (path === "/v1/jobs" && method === "POST") {
				const raw = await readBody(req)
				let body
				try { body = JSON.parse(raw.toString("utf8") || "{}") } catch { return send(res, 400, { error: "invalid JSON body" }) }
				const job = body.job !== undefined ? body.job : body
				const check = spec.validateJob(job)
				if (!check.valid) return send(res, 400, { error: "invalid job", errors: check.errors, warnings: check.warnings })
				// Optional inline input video (base64). Persisted for the worker.
				let inputPath = null
				if (body.input && body.input.base64) {
					inputPath = join(uploadsDir, randomUUID() + "-" + (body.input.name || "input.mp4").replace(/[^\w.\-]/g, "_"))
					writeFileSync(inputPath, Buffer.from(body.input.base64, "base64"))
				} else if (body.input && body.input.path) {
					if (!allowInputPath) return send(res, 400, { error: "input.path is disabled", hint: "upload base64 input or set TP_ALLOW_INPUT_PATH=1 for a trusted local client" })
					inputPath = resolve(body.input.path)
				}
				const v = queue.enqueue(job, { inputPath, ownedInput: !!(body.input && body.input.base64) })
				return send(res, 202, { ...v, links: linksFor(v.id) })
			}

			if (path === "/v1/jobs" && method === "GET") return send(res, 200, { jobs: queue.list() })

			const m = path.match(/^\/v1\/jobs\/([^/]+)(\/manifest|\/artifacts(?:\/(.+))?|\/cancel)?$/)
			if (m) {
				const id = decodeURIComponent(m[1])
				const sub = m[2] || ""
				const artifactName = m[3] ? decodeURIComponent(m[3]) : null
				const v = queue.get(id)
				if (!v) return send(res, 404, { error: "job not found", id })

				if (sub === "" && method === "GET") return send(res, 200, { ...v, links: linksFor(id) })
				if (sub === "/cancel" && method === "POST") return send(res, 200, queue.cancel(id))
				if (sub === "" && method === "DELETE") {
					const removed = queue.remove(id)
					if (removed?.busy) return send(res, 409, { error: "job is not terminal", job: removed.view })
					return send(res, 200, removed)
				}
				if (sub === "/manifest" && method === "GET") {
					const man = queue.manifest(id)
					if (!man) return send(res, 409, { error: "manifest not ready", status: v.status })
					return send(res, 200, man)
				}
				if (sub === "/artifacts" && method === "GET") return send(res, 200, { artifacts: v.artifacts })
				if (sub.startsWith("/artifacts/") && artifactName && method === "GET") {
					const a = queue.artifactPath(id, artifactName)
					if (!a) return send(res, 404, { error: "artifact not found", name: artifactName })
					res.writeHead(200, { "content-type": a.mime || "application/octet-stream", "content-length": a.bytes, ...(res._tpCorsHeaders || {}) })
					return createReadStream(a.path).pipe(res)
				}
			}

			return send(res, 404, { error: "not found", path })
		} catch (e) {
			return send(res, 500, { error: "internal", detail: String(e && e.message || e) })
		}
	})

	function linksFor(id) {
		return {
			self: `/v1/jobs/${id}`,
			manifest: `/v1/jobs/${id}/manifest`,
			artifacts: `/v1/jobs/${id}/artifacts`,
			cancel: `/v1/jobs/${id}/cancel`,
		}
	}

	function listen(port = Number(process.env.PORT || 8787), host = process.env.TP_HOST || "127.0.0.1") {
		return new Promise((resolveListen, rejectListen) => {
			server.once("error", rejectListen)
			server.listen(port, host, () => {
				server.off("error", rejectListen)
				const addr = server.address()
				const displayHost = typeof addr === "object" && addr?.address ? addr.address : host
				resolveListen({ port: addr.port, host: displayHost, url: `http://${displayHost}:${addr.port}` })
			})
		})
	}
	function close() { return new Promise((r) => server.close(() => r())) }

	return { server, queue, listen, close, mode, get url() { const a = server.address(); return a && typeof a === "object" ? `http://${a.address}:${a.port}` : null } }
}
