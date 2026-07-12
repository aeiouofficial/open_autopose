// Example-plugin kernel math (Tier 3). Pure + offline, tiny fixtures.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const K = require(resolve(__dirname, "..", "plugins", "kernels.js"))

// Build an RGBA buffer from a width and a per-pixel gray function.
function gray(w, h, fn) {
	const data = new Uint8ClampedArray(w * h * 4)
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
		const v = fn(x, y), i = (y * w + x) * 4
		data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255
	}
	return { data, width: w, height: h }
}

test("sobel fires on a vertical edge, silent on a flat field", () => {
	const edge = gray(8, 8, (x) => (x < 4 ? 0 : 255))
	const flat = gray(8, 8, () => 128)
	const eImg = K.sobelEdges(edge, { threshold: 90 })
	const fImg = K.sobelEdges(flat, { threshold: 90 })
	const alpha = (img) => { let s = 0; for (let p = 3; p < img.data.length; p += 4) s += img.data[p] > 0 ? 1 : 0; return s }
	assert.ok(alpha(eImg) > 0, "edge should produce lit pixels")
	assert.equal(alpha(fImg), 0, "flat field should produce none")
})

test("segmentByDiff: background diff marks changed pixels only", () => {
	const bg = gray(6, 6, () => 20)
	const cur = gray(6, 6, (x, y) => (x >= 3 ? 200 : 20)) // right half changed
	const mask = K.segmentByDiff(cur, { background: bg, threshold: 40 })
	assert.ok(mask.coverage > 0.4 && mask.coverage < 0.6, "about half foreground, got " + mask.coverage)
	// left half (unchanged) must be transparent
	assert.equal(mask.data[(0 * 6 + 0) * 4 + 3], 0)
	// right half (changed) must be tinted
	assert.ok(mask.data[(0 * 6 + 5) * 4 + 3] > 0)
})

test("frameDiffFlow: motion energy where pixels changed", () => {
	const prev = gray(32, 32, () => 0)
	const cur = gray(32, 32, (x, y) => (x >= 16 ? 255 : 0)) // right half moved
	const flow = K.frameDiffFlow(prev, cur, { block: 16, threshold: 8 })
	assert.equal(flow.cols, 2)
	assert.equal(flow.rows, 2)
	const hot = flow.vectors.filter((v) => v.mag > 8)
	assert.ok(hot.length >= 1, "expected at least one high-motion block")
	// a static prev/cur pair yields zero motion
	const still = K.frameDiffFlow(prev, prev, { block: 16 })
	assert.equal(still.vectors.every((v) => v.mag === 0), true)
})
