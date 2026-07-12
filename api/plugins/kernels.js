// =============================================================================
// Open AutoPose — example-plugin image kernels (Tier 3)
// -----------------------------------------------------------------------------
// Pure, dependency-free UMD image-processing kernels used by the first-party
// example plugins (edges / optical-flow / segmentation). Shared between the
// browser (the plugins call TPKernels.*) and Node (the unit tests import the
// exact same functions) so there is no math duplication / drift.
//
// All kernels operate on a plain { data:Uint8ClampedArray|Array, width, height }
// RGBA buffer — the same shape as ImageData — and return a new buffer of the
// same shape. They never touch the DOM, so they run and test anywhere.
// =============================================================================

(function (root, factory) {
	if (typeof module === "object" && module.exports) module.exports = factory()
	else root.TPKernels = factory()
})(typeof self !== "undefined" ? self : this, function () {
	"use strict"

	function luma(data, i) { return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] }
	function make(w, h) { return { data: new (typeof Uint8ClampedArray !== "undefined" ? Uint8ClampedArray : Array)(w * h * 4), width: w, height: h } }

	// ---- Sobel edge detection -> white edges on transparent bg ---------------
	function sobelEdges(img, opts) {
		opts = opts || {}
		const threshold = opts.threshold == null ? 90 : opts.threshold
		const w = img.width, h = img.height, d = img.data
		const out = make(w, h)
		const o = out.data
		for (let y = 1; y < h - 1; y++) {
			for (let x = 1; x < w - 1; x++) {
				const gx = (
					-lum(d, x - 1, y - 1, w) + lum(d, x + 1, y - 1, w) +
					-2 * lum(d, x - 1, y, w) + 2 * lum(d, x + 1, y, w) +
					-lum(d, x - 1, y + 1, w) + lum(d, x + 1, y + 1, w))
				const gy = (
					-lum(d, x - 1, y - 1, w) - 2 * lum(d, x, y - 1, w) - lum(d, x + 1, y - 1, w) +
					lum(d, x - 1, y + 1, w) + 2 * lum(d, x, y + 1, w) + lum(d, x + 1, y + 1, w))
				const mag = Math.sqrt(gx * gx + gy * gy)
				const i = (y * w + x) * 4
				if (mag >= threshold) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = Math.min(255, mag) }
			}
		}
		return out
	}
	function lum(d, x, y, w) { const i = (y * w + x) * 4; return luma(d, i) }

	// ---- Segmentation by background difference (or luma threshold) -----------
	// If `background` is provided, foreground = |luma - bgLuma| > threshold.
	// Otherwise a simple luma-band keeps mid/high-luma pixels. Returns an RGBA
	// mask (opaque foreground tint, transparent background).
	function segmentByDiff(img, opts) {
		opts = opts || {}
		const threshold = opts.threshold == null ? 40 : opts.threshold
		const tint = opts.tint || [93, 202, 165] // TP teal
		const bg = opts.background || null
		const w = img.width, h = img.height, d = img.data
		const out = make(w, h), o = out.data
		let fg = 0
		for (let p = 0; p < w * h; p++) {
			const i = p * 4
			const L = luma(d, i)
			let keep
			if (bg) keep = Math.abs(L - luma(bg.data, i)) > threshold
			else keep = L > threshold
			if (keep) { o[i] = tint[0]; o[i + 1] = tint[1]; o[i + 2] = tint[2]; o[i + 3] = 140; fg++ }
		}
		out.coverage = fg / (w * h)
		return out
	}

	// ---- Optical flow (block frame-difference motion field) ------------------
	// Coarse per-block motion energy between prev and cur luma. Returns
	// { vectors:[{x,y,mag}], cols, rows, block } for the plugin to draw, plus an
	// RGBA heat overlay. Deterministic and cheap — not Lucas-Kanade, but enough
	// to prove per-frame state + the registerLayer draw contract.
	function frameDiffFlow(prev, cur, opts) {
		opts = opts || {}
		const block = Math.max(4, opts.block || 16)
		const w = cur.width, h = cur.height
		const cols = Math.floor(w / block), rows = Math.floor(h / block)
		const vectors = []
		const out = make(w, h), o = out.data
		for (let by = 0; by < rows; by++) {
			for (let bx = 0; bx < cols; bx++) {
				let sum = 0, n = 0
				for (let y = by * block; y < (by + 1) * block; y++) {
					for (let x = bx * block; x < (bx + 1) * block; x++) {
						const i = (y * w + x) * 4
						sum += Math.abs(luma(cur.data, i) - luma(prev.data, i)); n++
					}
				}
				const mag = n ? sum / n : 0
				vectors.push({ bx: bx, by: by, mag: mag })
				if (mag > (opts.threshold == null ? 8 : opts.threshold)) {
					const a = Math.min(180, mag * 2)
					for (let y = by * block; y < (by + 1) * block; y++) {
						for (let x = bx * block; x < (bx + 1) * block; x++) {
							const i = (y * w + x) * 4
							o[i] = 237; o[i + 1] = 147; o[i + 2] = 177; o[i + 3] = a // TP magenta-ish
						}
					}
				}
			}
		}
		return { overlay: out, vectors: vectors, cols: cols, rows: rows, block: block }
	}

	return {
		VERSION: "tp.kernels/v1",
		luma: luma,
		sobelEdges: sobelEdges,
		segmentByDiff: segmentByDiff,
		frameDiffFlow: frameDiffFlow,
	}
})
