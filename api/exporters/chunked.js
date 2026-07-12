// =============================================================================
// First-party exporter — chunked / streaming PNG segments (Tier 3)
// -----------------------------------------------------------------------------
// Proves TP.registerExporter() and solves the "long clip blows up memory"
// problem: instead of holding every frame, it walks the range through the same
// harness the built-in exporters use and flushes ONE bounded segment at a time
// (a zip of PNGs per chunk) using the deterministic TPChunking planner. Peak
// memory is ~one chunk, so hour-long clips export on modest machines.
//
// Load order (offline-safe):
//   <script src="api/chunking.js"></script>       // TPChunking
//   <script src="api/exporters/chunked.js"></script>
// then:  await TP.runExporter('chunked-frames')
//
// Chunk size comes from state.export.chunkFrames (falls back to 300).
// =============================================================================

(function () {
	"use strict"
	if (typeof TP === "undefined" || !TP.registerExporter) { console.warn("[tp-chunked] window.TP not ready"); return }
	var Chunk = (typeof TPChunking !== "undefined") ? TPChunking : (typeof require === "function" ? require("../chunking.js") : null)
	if (!Chunk) { console.warn("[tp-chunked] TPChunking missing (load api/chunking.js first)"); return }

	function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n }

	TP.registerExporter({
		id: "chunked-frames",
		name: "Chunked PNG segments (long clips)",
		async run(api) {
			var inFrame = api.range.inFrame, outFrame = api.range.outFrame
			var chunkFrames = (api.state && api.state.export && api.state.export.chunkFrames) || 300
			var plan = Chunk.planChunks({ inFrame: inFrame, outFrame: outFrame, chunkFrames: chunkFrames })
			api.status("chunked export: " + plan.count + " segment(s) × ≤" + chunkFrames + " frames")

			// fflate for zipping each segment; resolveDep keeps it offline-safe.
			var fflate = await import(api.resolveDep("https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm"))

			function segmentOf(i) {
				for (var s = 0; s < plan.segments.length; s++) {
					var seg = plan.segments[s]
					if (i >= seg.start && i <= seg.end) return seg
				}
				return null
			}

			var current = null // { seg, files:{} }
			function flush() {
				if (!current) return
				var zipped = fflate.zipSync(current.files, { level: 6 })
				api.emit(zipped, "segment_" + pad(current.seg.index, 3) + ".zip", "application/zip")
				api.status("emitted segment " + (current.seg.index + 1) + "/" + plan.count)
				current = null
			}

			await api.forEachFrame(async function (canvas, i) {
				var seg = segmentOf(i)
				if (!seg) return
				if (!current || current.seg.index !== seg.index) { flush(); current = { seg: seg, files: {} } }
				var blob = await new Promise(function (r) { canvas.toBlob(r, "image/png") })
				var buf = new Uint8Array(await blob.arrayBuffer())
				current.files["frame_" + pad(i, 6) + ".png"] = buf
			})
			flush()
			api.status("chunked export done: " + plan.count + " segment(s)")
		},
	})
})()
