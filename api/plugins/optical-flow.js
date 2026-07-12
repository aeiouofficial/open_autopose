// =============================================================================
// Example plugin — Optical flow (first-party, proves TP.registerLayer)
// -----------------------------------------------------------------------------
// Visualizes per-block motion energy between the PREVIOUS and CURRENT source
// frame as a magenta heat overlay. Demonstrates that a layer can keep its own
// per-frame STATE across draw() calls (the previous frame) — the harness calls
// draw() in strict frame order for both preview and export.
// =============================================================================

(function () {
	"use strict"
	if (typeof TP === "undefined" || !TP.registerLayer) { console.warn("[tp-flow] window.TP not ready"); return }
	var K = (typeof TPKernels !== "undefined") ? TPKernels : (typeof require === "function" ? require("./kernels.js") : null)
	if (!K) { console.warn("[tp-flow] TPKernels missing"); return }

	var scratch = document.createElement("canvas")
	var sctx = scratch.getContext("2d", { willReadFrequently: true })
	var prev = null
	var prevFi = -1

	TP.registerLayer({
		id: "example.optical-flow",
		name: "Optical flow (block diff)",
		enabled: true,
		draw: function (ctx, api) {
			var src = api.source || api.frame
			if (!src) return
			var w = api.w, h = api.h
			scratch.width = w; scratch.height = h
			sctx.drawImage(src, 0, 0, w, h)
			var cur = sctx.getImageData(0, 0, w, h)
			// Reset history on a seek / non-monotonic frame index.
			if (prev && api.fi === prevFi + 1) {
				var flow = K.frameDiffFlow(prev, cur, { block: (api.state && api.state.flowBlock) || 16 })
				sctx.putImageData(new ImageData(flow.overlay.data, w, h), 0, 0)
				ctx.drawImage(scratch, 0, 0)
			}
			prev = cur
			prevFi = api.fi
		},
	})
})()
