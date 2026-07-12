// Chunk planner contract (Tier 3, streaming export). Pure + offline.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const { planChunks } = require(resolve(__dirname, "..", "chunking.js"))

test("exact coverage, no overlap: 100 frames / 30", () => {
	const { segments, count, totalFrames } = planChunks({ inFrame: 0, outFrame: 99, chunkFrames: 30 })
	assert.equal(totalFrames, 100)
	assert.equal(count, 4)
	assert.deepEqual(segments.map((s) => [s.start, s.end]), [[0, 29], [30, 59], [60, 89], [90, 99]])
	assert.equal(segments.reduce((a, s) => a + s.emit, 0), 100)
})

test("non-zero inFrame is honored", () => {
	const { segments, totalFrames } = planChunks({ inFrame: 10, outFrame: 25, chunkFrames: 8 })
	assert.equal(totalFrames, 16)
	assert.equal(segments[0].start, 10)
	assert.equal(segments[segments.length - 1].end, 25)
})

test("overlap adds lead-in but emitted frames still cover the range exactly", () => {
	const { segments, totalFrames } = planChunks({ inFrame: 0, outFrame: 99, chunkFrames: 30, overlap: 5 })
	assert.equal(totalFrames, 100)
	assert.equal(segments[0].leadIn, 0)
	assert.ok(segments[1].leadIn === 5)
	assert.equal(segments.reduce((a, s) => a + s.emit, 0), 100)
	// consecutive segments must advance by (chunk - overlap)
	assert.equal(segments[1].start - segments[0].start, 25)
})

test("single chunk when clip fits", () => {
	const { count, segments } = planChunks({ inFrame: 0, outFrame: 9, chunkFrames: 100 })
	assert.equal(count, 1)
	assert.deepEqual([segments[0].start, segments[0].end], [0, 9])
})

test("one frame", () => {
	const { count, totalFrames } = planChunks({ inFrame: 7, outFrame: 7, chunkFrames: 30 })
	assert.equal(count, 1)
	assert.equal(totalFrames, 1)
})

test("deterministic: identical inputs -> identical plan", () => {
	const a = JSON.stringify(planChunks({ inFrame: 0, outFrame: 250, chunkFrames: 24, overlap: 3 }))
	const b = JSON.stringify(planChunks({ inFrame: 0, outFrame: 250, chunkFrames: 24, overlap: 3 }))
	assert.equal(a, b)
})

test("rejects outFrame < inFrame", () => {
	assert.throws(() => planChunks({ inFrame: 10, outFrame: 5, chunkFrames: 4 }))
})
