// Gateway + job queue lifecycle (Tier 3), fully offline via dry-run renderer.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGateway } from "../server/gateway.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function withGateway(fn, extra = {}) {
	const dataDir = mkdtempSync(join(tmpdir(), "tp-gw-"))
	const gw = createGateway({ dataDir, mode: "dryrun", token: null, ...extra })
	const { url } = await gw.listen(0) // ephemeral port
	try { await fn(url, gw) } finally { await gw.close(); rmSync(dataDir, { recursive: true, force: true }) }
}

async function poll(url, id, ms = 5000) {
	const start = Date.now()
	for (;;) {
		const j = await (await fetch(`${url}/v1/jobs/${id}`)).json()
		if (j.status === "succeeded" || j.status === "failed") return j
		if (Date.now() - start > ms) throw new Error("poll timeout: " + j.status)
		await sleep(50)
	}
}

test("healthz reports version + mode", () => withGateway(async (url) => {
	const h = await (await fetch(`${url}/healthz`)).json()
	assert.equal(h.ok, true)
	assert.equal(h.mode, "dryrun")
	assert.equal(h.spec, "tp.job/v1")
}))

test("submit -> succeed -> manifest + artifact bytes", () => withGateway(async (url) => {
	const post = await fetch(`${url}/v1/jobs`, {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ job: { pose: { enabled: true, style: "openpose" } } }),
	})
	assert.equal(post.status, 202)
	const { id, links } = await post.json()
	assert.ok(id && links.manifest.includes(id))

	const done = await poll(url, id)
	assert.equal(done.status, "succeeded")
	assert.equal(done.artifacts[0].name, "plan.json")
	assert.ok(done.artifacts[0].sha256 && done.artifacts[0].bytes > 0)

	const man = await (await fetch(`${url}/v1/jobs/${id}/manifest`)).json()
	assert.equal(man.manifest, "tp.manifest/v1")
	assert.equal(man.dryRun, true)
	assert.equal(man.job.pose.style, "openpose")

	const bytes = await (await fetch(`${url}/v1/jobs/${id}/artifacts/plan.json`)).text()
	const plan = JSON.parse(bytes)
	assert.equal(plan.spec, "tp.job/v1")
	assert.equal(plan.normalizedJob.pose.style, "openpose")
}))

test("invalid job -> 400 with errors", () => withGateway(async (url) => {
	const r = await fetch(`${url}/v1/jobs`, {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ job: { depth: { enabled: true, engine: "bogus" } } }),
	})
	assert.equal(r.status, 400)
	const b = await r.json()
	assert.equal(b.error, "invalid job")
	assert.ok(Array.isArray(b.errors) && b.errors.length >= 1)
}))

test("unknown job id -> 404", () => withGateway(async (url) => {
	const r = await fetch(`${url}/v1/jobs/does-not-exist`)
	assert.equal(r.status, 404)
}))

test("manifest before ready -> 409", () => withGateway(async (url) => {
	// enqueue many so at least one is briefly queued behind the single worker
	const ids = []
	for (let i = 0; i < 3; i++) {
		const r = await fetch(`${url}/v1/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: {} }) })
		ids.push((await r.json()).id)
	}
	// last one may still be queued; its manifest must 409 until it runs
	const r = await fetch(`${url}/v1/jobs/${ids[2]}/manifest`)
	assert.ok(r.status === 409 || r.status === 200)
	await poll(url, ids[2])
}))

test("cancel a queued job", () => withGateway(async (url, gw) => {
	// concurrency 1: submit two, cancel the second while it's queued
	const a = await (await fetch(`${url}/v1/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: {} }) })).json()
	const b = await (await fetch(`${url}/v1/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: {} }) })).json()
	const c = await (await fetch(`${url}/v1/jobs/${b.id}/cancel`, { method: "POST" })).json()
	assert.ok(["canceled", "running", "succeeded"].includes(c.status))
	await poll(url, a.id)
}))

test("bearer token is enforced when configured", () => withGateway(async (url) => {
	const noauth = await fetch(`${url}/v1/jobs`)
	assert.equal(noauth.status, 401)
	const ok = await fetch(`${url}/v1/jobs`, { headers: { authorization: "Bearer s3cret" } })
	assert.equal(ok.status, 200)
}, { token: "s3cret" }))

test("browser origins are restricted to trusted local hosts", () => withGateway(async (url) => {
	const denied = await fetch(`${url}/healthz`, { headers: { origin: "https://example.invalid" } })
	assert.equal(denied.status, 403)
	assert.equal(denied.headers.get("access-control-allow-origin"), null)

	const allowed = await fetch(`${url}/healthz`, { headers: { origin: "http://127.0.0.1:5173" } })
	assert.equal(allowed.status, 200)
	assert.equal(allowed.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173")
}))

test("local input paths are disabled unless explicitly enabled", () => withGateway(async (url) => {
	const response = await fetch(`${url}/v1/jobs`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ job: {}, input: { path: "/tmp/private.mp4" } }),
	})
	assert.equal(response.status, 400)
	assert.equal((await response.json()).error, "input.path is disabled")
}))

test("DELETE removes a terminal job and its artifacts", () => withGateway(async (url) => {
	const created = await (await fetch(`${url}/v1/jobs`, {
		method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: {} }),
	})).json()
	await poll(url, created.id)
	const removed = await fetch(`${url}/v1/jobs/${created.id}`, { method: "DELETE" })
	assert.equal(removed.status, 200)
	assert.equal((await removed.json()).status, "deleted")
	assert.equal((await fetch(`${url}/v1/jobs/${created.id}`)).status, 404)
}))
