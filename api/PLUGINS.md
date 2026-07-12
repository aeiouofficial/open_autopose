# Open AutoPose plugins & presets (v4.4)

Extend the renderer at runtime — no build step, no fork. Everything is additive
and stays inert until you register something.

```js
// paste in the app's devtools console, or load from your own <script>
TP.registerLayer({ /* … */ })
TP.registerExporter({ /* … */ })
TP.presets.save('My look')
```

---

## Custom layers — `TP.registerLayer(layer)`

A layer draws on top of the composite for **every** frame — live preview *and*
export — so what you see is what you get.

```ts
interface TPLayer {
  id: string                 // unique; re-registering the same id replaces it
  name?: string              // label in the Plugins panel
  enabled?: boolean          // default true; toggle from the panel or code
  draw(ctx: CanvasRenderingContext2D, info: {
    fi: number               // frame index being drawn
    w: number; h: number     // canvas dimensions
    state: object            // TP.getState() snapshot
    frame: object            // per-frame pose/depth data when available
  }): void
}

TP.registerLayer({
  id: 'crosshair',
  name: 'Center crosshair',
  draw(ctx, { w, h }) {
    ctx.strokeStyle = '#ED93B1'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h);
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
  },
})

TP.unregisterLayer('crosshair')
TP.plugins.layers        // read-only snapshot
```

The context is already wrapped in `save()`/`restore()`, so you don't have to
clean up transforms/styles. Layers run in registration order.

---

## Custom exporters — `TP.registerExporter(exp)`

An exporter reuses the exact same frame-walking harness as the built-in MP4/PNG
exporters, so you never re-implement seeking or compositing.

```ts
interface TPExporter {
  id: string
  name?: string
  run(api: {
    range: { inFrame: number; outFrame: number; frames: number }
    fps: number
    dims: [number, number]                 // export [w, h]
    state: object
    resolveDep(url: string): string         // known upstream URL -> ./vendor when offline
    status(msg: string): void               // write to the app status line
    forEachFrame(cb: (canvas, i, w, h) => void | Promise<void>): Promise<void>
    emit(bytes: Uint8Array|Blob|ArrayBuffer, filename: string, mime: string): void
  }): Promise<void> | void
}

TP.registerExporter({
  id: 'contact-sheet',
  name: 'Contact sheet (every 12th frame)',
  async run(api) {
    const [w, h] = api.dims
    api.status('building contact sheet…')
    const shots = []
    await api.forEachFrame((canvas, i) => { if (i % 12 === 0) shots.push(canvas.toDataURL()) })
    // …compose your own artifact from `shots`…
    api.emit(new TextEncoder().encode(shots.join('\n')), 'sheet.txt', 'text/plain')
  },
})

await TP.runExporter('contact-sheet')
```

Use `resolveDep()` for known upstream assets so an exporter can use the prepared local vendor path in offline mode.

---

## Preset library — `TP.presets`

Presets capture the full control panel and are stored in `localStorage` under
`tp.presets.v1`. They also appear in the UI **Presets** panel.

```js
TP.presets.list()                 // [{ id, name, patch }]
const id = TP.presets.save('Neon silhouette')
TP.presets.apply(id)              // re-apply (validated via tp.job/v1)
TP.presets.remove(id)
const json = TP.presets.export()  // portable — share between machines
TP.presets.import(json)           // merge
```

A preset `patch` is a partial `tp.job/v1` object; applying it runs through
`normalizeJob()` so an invalid/out-of-range value can never corrupt the panel.

---

## Offline engine — `TP.offline`

Plugins and exporters keep working with no network once the vendor set is
populated (`node vendor/fetch-vendor.mjs`).

```js
TP.offline.enabled      // boolean
TP.offline.vendorBase   // './vendor/'
TP.offline.set(true)    // persist + reload into the vendored path
```

Toggle it from **Settings → “Offline engine (vendored deps)”** or with the
`?offline=1` URL parameter. See `../vendor/README.md`.

---

## Stability notes

- The registries are versioned with the app (`TP.version`). The shapes above are
  the v4.4 contract.
- Registering an existing `id` replaces the previous entry (idempotent reloads).
- Errors thrown inside a layer/exporter are caught and logged; they will not
  crash the render loop.

---

## First-party add-ons (v4.5)

Shipped, loadable examples that prove the surfaces above — all pure/offline:

| File | Surface | What it shows |
|------|---------|---------------|
| `plugins/edges.js` | `registerLayer` | Sobel edge overlay from the source frame |
| `plugins/segmentation.js` | `registerLayer` | Background-difference foreground mask |
| `plugins/optical-flow.js` | `registerLayer` | Block motion energy — stateful across frames |
| `exporters/chunked.js` | `registerExporter` | Streaming PNG-zip segments for long clips (bounded memory) |
| `plugins/kernels.js`, `chunking.js` | — | Shared UMD math, unit-tested in Node |

Load `chunking.js` / `kernels.js` before the add-ons that use them. See
`plugins/README.md`.
