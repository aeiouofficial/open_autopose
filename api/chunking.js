// =============================================================================
// Open AutoPose — chunk planner (Tier 3, streaming export)
// -----------------------------------------------------------------------------
// Pure, dependency-free UMD module shared by BOTH Node (tests / gateway) and
// the browser (the app's chunked exporter). Given a frame range and a chunk
// size it produces a deterministic list of segments so long clips can be
// exported a bounded number of frames at a time (bounded memory), then
// concatenated / zipped.
//
// Design goals:
//   - Deterministic: same inputs -> byte-identical plan (reproducibility).
//   - Total frame coverage is exact (sum of segment counts == total).
//   - No overlap, monotonically increasing, inclusive [start,end] per segment.
// =============================================================================

(function (root, factory) {
	if (typeof module === "object" && module.exports) module.exports = factory()
	else root.TPChunking = factory()
})(typeof self !== "undefined" ? self : this, function () {
	"use strict"

	/**
	 * Plan chunk segments over an inclusive frame range.
	 * @param {object} o
	 * @param {number} o.inFrame      first frame index (inclusive, >=0)
	 * @param {number} o.outFrame     last frame index (inclusive, >= inFrame)
	 * @param {number} o.chunkFrames  max frames per segment (>=1)
	 * @param {number} [o.overlap=0]  frames each segment shares with the previous
	 *                                one (useful for temporal filters that need
	 *                                context, e.g. VDA depth). Overlap frames are
	 *                                marked so the muxer can drop duplicates.
	 * @returns segments:Array,totalFrames:number,count:number
	 */
	function planChunks(o) {
		const inFrame = int(o && o.inFrame, 0)
		const outFrame = int(o && o.outFrame, 0)
		const chunkFrames = Math.max(1, int(o && o.chunkFrames, 1))
		const overlap = Math.max(0, Math.min(chunkFrames - 1, int(o && o.overlap, 0)))
		if (outFrame < inFrame) throw new Error("planChunks: outFrame < inFrame")

		const totalFrames = outFrame - inFrame + 1
		const segments = []
		let start = inFrame
		let index = 0
		const step = chunkFrames - overlap // advance per segment
		while (start <= outFrame) {
			const end = Math.min(start + chunkFrames - 1, outFrame)
			const leadIn = index === 0 ? 0 : overlap // context frames to render but drop
			segments.push({
				index: index,
				start: start,
				end: end,
				count: end - start + 1,
				leadIn: leadIn,
				emit: end - (start + leadIn) + 1, // frames actually kept
			})
			if (end === outFrame) break
			start += step
			index++
		}
		// Emitted frames (dropping lead-in overlaps) must cover the range exactly.
		const emitted = segments.reduce(function (s, x) { return s + x.emit }, 0)
		if (emitted !== totalFrames) {
			throw new Error("planChunks: coverage mismatch " + emitted + " != " + totalFrames)
		}
		return { segments: segments, totalFrames: totalFrames, count: segments.length }
	}

	function int(v, d) { v = Math.trunc(Number(v)); return isFinite(v) ? v : d }

	return { planChunks: planChunks, VERSION: "tp.chunking/v1" }
})
