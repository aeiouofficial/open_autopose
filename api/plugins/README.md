# First-party example plugins

These prove the **`TP.registerLayer()`** surface shipped in v4.4. All three are
pure canvas + `kernels.js` — **no network, no model download** — so they run
offline and their math is unit-tested in Node (`api/tests/plugins.test.mjs`).

| File | Layer id | What it shows |
|------|----------|---------------|
| `edges.js` | `example.edges` | Per-frame Sobel edge overlay from the source frame |
| `segmentation.js` | `example.segmentation` | Background-difference foreground mask (swap in a vendored MediaPipe model for production) |
| `optical-flow.js` | `example.optical-flow` | Block motion energy between consecutive frames — demonstrates per-layer state across `draw()` calls |
| `kernels.js` | — | Shared, dependency-free UMD image kernels (browser global `TPKernels` **and** Node `require`) |

## Load in the app

Open `public/app.html`, then in the DevTools console (or via a
`<script>` tag added after the app):

```html
<script src="api/plugins/kernels.js"></script>
<script src="api/plugins/edges.js"></script>
<script src="api/plugins/segmentation.js"></script>
<script src="api/plugins/optical-flow.js"></script>
```

Each script self-registers a layer; toggle them from the **Plugins** panel
(added in v4.4). Remove one with `TP.unregisterLayer("example.edges")`.

## The layer contract

```js
TP.registerLayer({
  id: "example.edges",       // unique
  name: "Edges (Sobel)",     // shown in the Plugins panel
  enabled: true,
  draw(ctx, api) {
    // ctx  : the composite CanvasRenderingContext2D (already save()'d)
    // api  : { fi, w, h, state, source, frame }
    //   fi     current frame index (monotonic during export)
    //   w,h    composite dimensions
    //   source decoded video frame for this fi (ImageBitmap/VideoFrame/canvas)
    //   state  live control-panel state (read-only snapshot)
  },
})
```

`draw()` runs for **every** frame in both live preview and export, in strict
frame order, wrapped in `ctx.save()/restore()` and a try/catch so a throwing
plugin can never crash the render loop. See `../PLUGINS.md` for the full API
(including `registerExporter`).
