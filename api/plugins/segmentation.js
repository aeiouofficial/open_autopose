// =============================================================================
// Example plugin — Segmentation mask (first-party, proves TP.registerLayer)
// -----------------------------------------------------------------------------
// Tints the foreground with a translucent teal mask using a background-
// difference (falls back to a luma band when no background frame is captured).
// Pure + dependency-free so it runs offline. For a production-grade mask you
// can swap TPKernels.segmentByDiff for a vendored MediaPipe SelfieSegmentation
// model via the v4.4 offline vendor path — the registerLayer contract is
// identical.
// =============================================================================

(function () {
	"use strict"
	if (typeof TP === "undefined" || !TP.registerLayer) { console.warn("[tp-seg] window.TP not ready"); return }
	var K = (typeof TPKernels !== "undefined") ? TPKernels : (typeof require === "function" ? require("./kernels.js") : null)
	if (!K) { console.warn("[tp-seg] TPKernels missing"); return }

	var scratch = document.createElement("canvas")
	var sctx = scratch.getContext("2d", { willReadFrequently: true })
	var background = null // captured on first frame as a naive plate

	TP.registerLayer({
		id: "example.segmentation",
		name: "Segmentation (bg-diff)",
		enabled: true,
		draw: function (ctx, api) {
			var src = api.source || api.frame
			if (!src) return
			var w = api.w, h = api.h
			scratch.width = w; scratch.height = h
			sctx.drawImage(src, 0, 0, w, h)
			var img = sctx.getImageData(0, 0, w, h)
			if (!background || background.width !== w) background = img // first frame = plate
			var mask = K.segmentByDiff(img, { background: background, threshold: (api.state && api.state.segThreshold) || 40 })
			sctx.putImageData(new ImageData(mask.data, w, h), 0, 0)
			ctx.drawImage(scratch, 0, 0)
		},
	})
})()
