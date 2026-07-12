// =============================================================================
// Open AutoPose — in-process job queue (Tier 3)
// -----------------------------------------------------------------------------
// A tiny, dependency-free FIFO queue with a bounded worker pool and on-disk
// persistence. It is deliberately storage-agnostic: the actual rendering is a
// `handler` passed in by the caller (real headless render, or a dry-run
// planner). The gateway is a thin HTTP shell around this.
//
// Job lifecycle:  queued -> running -> succeeded | failed | canceled
//
// Everything a job produces (manifest.json + artifacts) is written under
//   <dataDir>/jobs/<id>/
// so a restarted process can still serve completed results.
// =============================================================================

import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const TERMINAL = new Set(["succeeded", "failed", "canceled"])

export function createQueue({ dataDir, concurrency = 1, handler }) {
	if (typeof handler !== "function") throw new Error("createQueue: handler(job) is required")
	const jobsDir = join(dataDir, "jobs")
	mkdirSync(jobsDir, { recursive: true })

	const jobs = new Map() // id -> record
	const waiting = [] // ids
	let active = 0

	// Re-hydrate any persisted jobs from a previous process.
	for (const id of safeReaddir(jobsDir)) {
		const metaPath = join(jobsDir, id, "job.json")
		if (!existsSync(metaPath)) continue
		try {
			const rec = JSON.parse(readFileSync(metaPath, "utf8"))
			// A job left "running" by a crash is not recoverable — mark it failed.
			if (rec.status === "running" || rec.status === "queued") {
				rec.status = "failed"
				rec.error = rec.error || "interrupted (process restarted before completion)"
			}
			jobs.set(id, rec)
		} catch { /* ignore corrupt record */ }
	}

	function dir(id) { return join(jobsDir, id) }
	function persist(rec) {
		mkdirSync(dir(rec.id), { recursive: true })
		const { _artifactBytes, ...clean } = rec
		writeFileSync(join(dir(rec.id), "job.json"), JSON.stringify(clean, null, 2))
	}

	function view(rec) {
		return {
			id: rec.id,
			status: rec.status,
			progress: rec.progress || null,
			error: rec.error || null,
			createdAt: rec.createdAt,
			startedAt: rec.startedAt || null,
			finishedAt: rec.finishedAt || null,
			manifestAvailable: !!rec.manifest,
			artifacts: (rec.artifacts || []).map((a) => ({ name: a.name, kind: a.kind, mime: a.mime, sha256: a.sha256, bytes: a.bytes })),
		}
	}

	function enqueue(job, opts = {}) {
		const id = randomUUID()
		const rec = {
			id, job, status: "queued", progress: null, error: null,
			inputPath: opts.inputPath || null, ownedInput: !!opts.ownedInput,
			createdAt: new Date().toISOString(), startedAt: null, finishedAt: null,
			manifest: null, artifacts: null,
		}
		jobs.set(id, rec)
		persist(rec)
		waiting.push(id)
		pump()
		return view(rec)
	}

	function pump() {
		while (active < concurrency && waiting.length) {
			const id = waiting.shift()
			const rec = jobs.get(id)
			if (!rec || rec.status !== "queued") continue
			run(rec)
		}
	}

	async function run(rec) {
		active++
		rec.status = "running"
		rec.startedAt = new Date().toISOString()
		persist(rec)
		try {
			const onProgress = (p) => { rec.progress = p; /* in-memory only; cheap */ }
			const { manifest, artifacts } = await handler({ id: rec.id, job: rec.job, inputPath: rec.inputPath, onProgress })
			// Persist artifact bytes to disk, keep only metadata in memory.
			const meta = []
			for (const a of artifacts || []) {
				const bytes = Buffer.from(a.base64, "base64")
				writeFileSync(join(dir(rec.id), a.name), bytes)
				meta.push({ name: a.name, kind: a.kind, mime: a.mime, sha256: a.sha256, bytes: bytes.length })
			}
			if (manifest) writeFileSync(join(dir(rec.id), "manifest.json"), JSON.stringify(manifest, null, 2))
			rec.manifest = manifest || null
			rec.artifacts = meta
			rec.status = "succeeded"
			rec.progress = { stage: "done", frac: 1 }
		} catch (e) {
			rec.status = "failed"
			rec.error = (e && e.message) || String(e)
		} finally {
			rec.finishedAt = new Date().toISOString()
			persist(rec)
			active--
			pump()
		}
	}

	function get(id) { const r = jobs.get(id); return r ? view(r) : null }
	function list() { return [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(view) }
	function manifest(id) { const r = jobs.get(id); return r ? r.manifest : undefined }

	function artifactPath(id, name) {
		const r = jobs.get(id)
		if (!r || !r.artifacts) return null
		const a = r.artifacts.find((x) => x.name === name)
		if (!a) return null
		return { path: join(dir(id), name), mime: a.mime, bytes: a.bytes }
	}

	function cancel(id) {
		const r = jobs.get(id)
		if (!r) return null
		if (TERMINAL.has(r.status)) return view(r) // already done; no-op
		if (r.status === "queued") {
			const i = waiting.indexOf(id)
			if (i >= 0) waiting.splice(i, 1)
			r.status = "canceled"
			r.finishedAt = new Date().toISOString()
			persist(r)
		} else {
			// Running jobs can't be force-killed cleanly across the headless
			// boundary; record the intent so callers know it won't be retried.
			r.cancelRequested = true
			persist(r)
		}
		return view(r)
	}


	function remove(id) {
		const r = jobs.get(id)
		if (!r) return null
		if (!TERMINAL.has(r.status)) return { busy: true, view: view(r) }
		if (r.ownedInput && r.inputPath) rmSync(r.inputPath, { force: true })
		rmSync(dir(id), { recursive: true, force: true })
		jobs.delete(id)
		return { busy: false, id, status: "deleted" }
	}

	function stats() {
		const s = { queued: 0, running: 0, succeeded: 0, failed: 0, canceled: 0, active, concurrency }
		for (const r of jobs.values()) s[r.status] = (s[r.status] || 0) + 1
		return s
	}

	return { enqueue, get, list, manifest, artifactPath, cancel, remove, stats, view }
}

function safeReaddir(p) { try { return readdirSync(p) } catch { return [] } }
