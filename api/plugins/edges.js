// =============================================================================
// Example plugin — Sobel edges (first-party, proves TP.registerLayer)
// -----------------------------------------------------------------------------
// Draws white edge lines detected from the SOURCE frame on top of the
// composite. Pure canvas + TPKernels.sobelEdges — no network, no model.
//
// Load AFTER the app (and after plugins/kernels.js):
//   <script src="plugins/kernels.js"></script>
//   <script src="plugins/edges.js"></script>
// or from the console:  TP.registerLayer(edgesLayer)
// =============================================================================

(function () {
	"use strict"
	if (typeof TP === "undefined" || !TP.registerLayer) { console.warn("[tp-edges] window.TP not ready"); return }
	var K = (typeof TPKernels !== "undefined") ? TPKernels : (typeof require === "function" ? require("./kernels.js") : null)
	if (!K) { console.warn("[tp-edges] TPKernels missing"); return }

	var scratch = document.createElement("canvas")
	var sctx = scratch.getContext("2d", { willReadFrequently: true })

	TP.registerLayer({
		id: "example.edges",
		name: "Edges (Sobel)",
		enabled: true,
		// api: { fi, w, h, state, ctx, source } — source is the decoded video frame
		draw: function (ctx, api) {
			var src = api.source || api.frame
			if (!src) return
			var w = api.w, h = api.h
			scratch.width = w; scratch.height = h
			sctx.drawImage(src, 0, 0, w, h)
			var img = sctx.getImageData(0, 0, w, h)
			var edges = K.sobelEdges(img, { threshold: (api.state && api.state.edgeThreshold) || 90 })
			sctx.putImageData(new ImageData(edges.data, w, h), 0, 0)
			ctx.drawImage(scratch, 0, 0)
		},
	})
})()
