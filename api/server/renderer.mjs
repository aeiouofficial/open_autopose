// =============================================================================
// Open AutoPose — render adapters for the gateway (Tier 3)
// -----------------------------------------------------------------------------
// The queue is renderer-agnostic. Two adapters are provided:
//
//   real    - drives the locally hosted built/vendored app via runJob(). A
//             WebGPU/WebCodecs-capable browser is needed for GPU rendering.
//   dryrun  - offline planner: validates + normalizes the job through the
//             dependency-free contract and probes real browser capabilities,
//             then emits a manifest-shaped record + a JSON plan artifact. No
//             GPU or model network access is required, so the gateway lifecycle is testable
//             anywhere. Clearly marked { dryRun: true } so nobody mistakes a
//             plan for a render.
//
// Select with TP_RENDER_MODE=real|dryrun (default: real).
// =============================================================================

import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const spec = require(resolve(__dirname, "..", "tp-spec.js"))

function sha256Hex(buf) { return createHash("sha256").update(buf).digest("hex") }

// Browser startup is comparatively expensive. All dry-run jobs in one process
// share one immutable capability snapshot instead of spawning a browser per job.
let dryRunCapsPromise = null
function dryRunCapabilities() {
	if (!dryRunCapsPromise) {
		dryRunCapsPromise = import("../runner/browser.mjs")
			.then(({ probeCapabilities }) => probeCapabilities())
			.catch((error) => ({ error: (error && error.message) || String(error) }))
	}
	return dryRunCapsPromise
}

// ---- dry-run (offline) ------------------------------------------------------
export async function dryRunRender({ job, onProgress }) {
	const pre = spec.validateJob(job)
	if (!pre.valid) throw new Error("invalid job: " + pre.errors.join("; "))
	const norm = spec.normalizeJob(job)

	const caps = await dryRunCapabilities()

	for (const stage of ["load", "track", "bake", "export"]) {
		if (typeof onProgress === "function") onProgress({ stage, frac: 1, dryRun: true })
	}

	const plan = { dryRun: true, spec: "tp.job/v1", normalizedJob: norm, capabilities: caps, warnings: pre.warnings }
	const bytes = Buffer.from(JSON.stringify(plan, null, 2))
	const manifest = {
		manifest: "tp.manifest/v1",
		app: { name: "open-autopose", version: "gateway-dryrun", spec: "tp.job/v1" },
		dryRun: true,
		capabilities: caps,
		job: norm,
		warnings: pre.warnings,
		artifacts: [{ name: "plan.json", kind: "plan", mime: "application/json", sha256: sha256Hex(bytes), bytes: bytes.length }],
		startedAt: new Date().toISOString(),
		finishedAt: new Date().toISOString(),
	}
	return {
		manifest,
		artifacts: [{ name: "plan.json", kind: "plan", mime: "application/json", sha256: sha256Hex(bytes), base64: bytes.toString("base64") }],
	}
}

// ---- real (headless render) -------------------------------------------------
export async function realRender({ job, inputPath, onProgress }, { appPath } = {}) {
	const pre = spec.validateJob(job)
	if (!pre.valid) throw new Error("invalid job: " + pre.errors.join("; "))
	const { runJob } = await import("../runner/browser.mjs")
	return runJob({ appPath, job, inputPath, onProgress })
}

export function makeRenderer({ mode = process.env.TP_RENDER_MODE || "real", appPath } = {}) {
	if (mode === "dryrun") return { mode, handler: (args) => dryRunRender(args) }
	return { mode: "real", handler: (args) => realRender(args, { appPath }) }
}
