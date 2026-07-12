#!/usr/bin/env node
// =============================================================================
// tp-mcp — Open AutoPose MCP server (Tier 1)
// -----------------------------------------------------------------------------
// Exposes the tp.job/v1 pipeline to any MCP client (Claude Desktop, Cursor, …)
// over the stdio transport. It is a thin wrapper: validation/normalization use
// the dependency-free validator; render tools drive the real app headlessly via
// the shared runner. No pipeline logic is duplicated here.
//
// Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout (the MCP stdio
// framing). Diagnostics go to stderr only — stdout carries protocol frames
// exclusively.
//
// Run:  node tp-mcp.mjs         (a client spawns this and speaks JSON-RPC)
// =============================================================================

import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve, join } from "node:path"
import { writeFile, mkdir } from "node:fs/promises"

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const spec = require(resolve(__dirname, "..", "tp-spec.js"))

const SERVER_INFO = { name: "open-autopose", version: "1.0.0" }
const PROTOCOL_VERSION = "2024-11-05"

const log = (...a) => process.stderr.write("[tp-mcp] " + a.join(" ") + "\n")

// ---------------------------------------------------------------------------
// Tool registry. Each tool declares a JSON Schema and an async handler that
// returns a plain object (serialized into MCP text content).
// ---------------------------------------------------------------------------
const JOB_SCHEMA = {
	type: "object",
	description: "A tp.job/v1 Job Spec (see api/tp.job.schema.json).",
	additionalProperties: true,
}

const TOOLS = [
	{
		name: "tp_validate_job",
		description: "Validate a tp.job/v1 Job Spec. Returns {valid, errors, warnings}. Offline.",
		inputSchema: { type: "object", properties: { job: JOB_SCHEMA }, required: ["job"] },
		handler: async ({ job }) => spec.validateJob(job),
	},
	{
		name: "tp_normalize_job",
		description: "Return the fully-defaulted normalized Job Spec (throws if invalid). Offline.",
		inputSchema: { type: "object", properties: { job: JOB_SCHEMA }, required: ["job"] },
		handler: async ({ job }) => spec.normalizeJob(job),
	},
	{
		name: "tp_list_capabilities",
		description: "Probe the real headless browser for WebGPU / WebCodecs / depth engines / limits.",
		inputSchema: { type: "object", properties: {} },
		handler: async () => {
			const { probeCapabilities } = await import("../runner/browser.mjs")
			return probeCapabilities()
		},
	},
	{
		name: "tp_render_controls",
		description:
			"Render control outputs (pose/depth/silhouette) for a local video via the headless app. " +
			"Args: { input (path), job (tp.job/v1), outDir }. Needs network + GPU browser.",
		inputSchema: {
			type: "object",
			properties: { input: { type: "string" }, job: JOB_SCHEMA, outDir: { type: "string" } },
			required: ["input", "job", "outDir"],
		},
		handler: (a) => renderTool(a.job, a.input, a.outDir),
	},
	{
		name: "tp_detect_poses",
		description:
			"Detect poses and return the pose JSON for a local video. Args: { input, outDir, characters? }.",
		inputSchema: {
			type: "object",
			properties: { input: { type: "string" }, outDir: { type: "string" }, characters: { type: "number" } },
			required: ["input", "outDir"],
		},
		handler: (a) => renderTool(
			{ characters: a.characters || 1, pose: { enabled: true }, output: { format: "json" } },
			a.input, a.outDir,
		),
	},
	{
		name: "tp_bake_depth",
		description:
			"Bake a depth control video for a local clip. Args: { input, outDir, engine? (fast|vda) }.",
		inputSchema: {
			type: "object",
			properties: { input: { type: "string" }, outDir: { type: "string" }, engine: { type: "string" } },
			required: ["input", "outDir"],
		},
		handler: (a) => renderTool(
			{ pose: { enabled: false }, depth: { enabled: true, engine: a.engine || "fast" }, output: { format: "mp4" } },
			a.input, a.outDir,
		),
	},
	{
		name: "tp_get_manifest",
		description: "Read a previously written manifest.json. Args: { path }. Offline.",
		inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		handler: async ({ path }) => JSON.parse(await readFile(resolve(path), "utf8")),
	},
]

async function renderTool(job, input, outDir) {
	const pre = spec.validateJob(job)
	if (!pre.valid) throw new Error("invalid job: " + pre.errors.join("; "))
	const { runJob } = await import("../runner/browser.mjs")
	const { manifest, artifacts } = await runJob({ job, inputPath: resolve(input) })
	await mkdir(outDir, { recursive: true })
	const written = []
	for (const a of artifacts) {
		const p = join(outDir, a.name)
		await writeFile(p, Buffer.from(a.base64, "base64"))
		written.push({ path: p, kind: a.kind, sha256: a.sha256 })
	}
	const manifestPath = join(outDir, "manifest.json")
	await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
	return { manifestPath, manifest, artifacts: written }
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 dispatch
// ---------------------------------------------------------------------------
function send(msg) {
	process.stdout.write(JSON.stringify(msg) + "\n")
}

function reply(id, result) { send({ jsonrpc: "2.0", id, result }) }
function replyError(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }) }

async function handleRequest(msg) {
	const { id, method, params } = msg
	switch (method) {
		case "initialize":
			return reply(id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: SERVER_INFO,
			})
		case "ping":
			return reply(id, {})
		case "tools/list":
			return reply(id, {
				tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
			})
		case "tools/call": {
			const tool = TOOLS.find((t) => t.name === (params && params.name))
			if (!tool) return replyError(id, -32602, `unknown tool: ${params && params.name}`)
			try {
				const result = await tool.handler((params && params.arguments) || {})
				return reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] })
			} catch (e) {
				return reply(id, {
					content: [{ type: "text", text: "Error: " + (e && e.message ? e.message : String(e)) }],
					isError: true,
				})
			}
		}
		default:
			if (id !== undefined) return replyError(id, -32601, `method not found: ${method}`)
	}
}

function main() {
	log(`ready — ${SERVER_INFO.name} v${SERVER_INFO.version} (${TOOLS.length} tools)`) 
	let buf = ""
	process.stdin.setEncoding("utf8")
	process.stdin.on("data", (chunk) => {
		buf += chunk
		let nl
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl).trim()
			buf = buf.slice(nl + 1)
			if (!line) continue
			let msg
			try { msg = JSON.parse(line) } catch { log("bad JSON frame"); continue }
			// Notifications (no id) get no response; requests do.
			Promise.resolve(handleRequest(msg)).catch((e) => log("handler error: " + e))
		}
	})
	process.stdin.on("end", () => process.exit(0))
}

main()
