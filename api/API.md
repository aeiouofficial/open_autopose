# Open AutoPose API — `tp.job/v1`

The Open AutoPose engine is driven by a single declarative **Job Spec**
(`tp.job/v1`). The GUI, the `window.TP` programmatic API, the `postMessage`
channel, the CLI, and the MCP server are all just *callers* of the same
contract. Build a Job Spec once, run it anywhere.

> **Status:** the API surface, schema, validator, types, and docs are stable and
> test-covered. A live render still needs a GPU browser (Chrome/Edge) for
> WebGPU / WebCodecs / MediaPipe / ONNX — the API cannot render in a headless
> sandbox without a GPU.

---

## 1. Files

| File | Purpose |
|------|---------|
| `api/tp-spec.js` | Canonical validator/normalizer (UMD; used by the app **and** Node/CLI) |
| `api/tp.job.schema.json` | JSON Schema (2020-12) for the Job Spec |
| `api/tp.manifest.schema.json` | JSON Schema for the Result manifest |
| `api/tp-api.d.ts` | TypeScript definitions for `window.TP`, jobs, and manifests |
| `api/tp-runtime.js` | The in-page runtime source that is embedded into the app |
| `api/examples/*.json` | Ready-to-run example jobs |
| `api/tests/spec.test.mjs` | `node --test` contract test suite |

---

## 2. Job Spec (`tp.job/v1`)

Every field is optional except that you must supply a video **either** via
`input.url` **or** by passing a `File`/`Blob` at run time.

```jsonc
{
  "spec": "tp.job/v1",
  "input": { "url": "./input.mp4" },         // or omit + pass opts.file
  "fps": "auto",                              // "auto" | 1..120
  "range": "all",                             // "all" | {inFrame,outFrame} | {startSec,endSec}
  "characters": 1,                            // 1..5 (>1 = multi-character)
  "confidence": 0.5,                          // 0..1
  "smoothing": 0.5,                           // 0..1 temporal pose smoothing
  "pose":       { "enabled": true,  "style": "openpose", "opacity": 1, "bone": 5, "joint": 6 },
  "silhouette": { "enabled": false, "style": "white", "opacity": 0.45 },
  "depth":      { "enabled": false, "engine": "fast", "stabilize": true, "invert": false, "smooth": 2, "opacity": 1, "tint": false },
  "camera": "match",                          // "match" | "free"
  "output": { "format": "mp4", "resolution": "source" }  // format: mp4|png|json or an array; resolution: source|512|768|1024
}
```

**Enums:** `pose.style` = `openpose|white`; `silhouette.style` =
`white|black|green|magenta`; `depth.engine` = `fast|vda` (`vda` =
temporally-consistent Video-Depth-Anything, needs WebGPU); `output.format` =
`mp4|png|json`.

**Tracking is implicit:** a track runs automatically when the output depends on
landmarks — i.e. when `pose.enabled`, `silhouette.enabled`, or `json` output is
requested. A depth-only job skips tracking.

---

## 3. `window.TP`

```ts
TP.version            // "v1.0.0"
TP.spec               // "tp.job/v1"
await TP.capabilities()          // { webgpu, webcodecs, depthEngines, … }
TP.validateJob(job)              // { valid, errors[], warnings[] }  (never throws)
TP.normalizeJob(job)             // fully-defaulted job              (throws if invalid)
TP.getState()                    // snapshot of the current clip/track/depth
await TP.run(job, opts)          // => { manifest, artifacts }
```

### `TP.run(job, opts)`

```ts
opts = {
  file?: File | Blob,                 // source video when job.input is omitted
  onProgress?: ({stage, frac}) => void,  // stage: load|track|bake|export
  download?: boolean,                  // default true; false = return blobs only
}
```

Returns:

```ts
{
  manifest: TPManifest,   // tp.manifest/v1 (see §5)
  artifacts: [ { name, kind, mime, bytes, sha256, blob } ]
}
```

**Example — render an OpenPose control MP4 from a dropped file:**

```js
const caps = await TP.capabilities();
if (!caps.webcodecs) throw new Error('need Chrome/Edge for MP4');

const { manifest, artifacts } = await TP.run({
  fps: 24,
  range: { startSec: 0, endSec: 4 },
  pose: { style: 'openpose' },
  depth: { enabled: true, engine: caps.webgpu ? 'vda' : 'fast' },
  output: { format: ['mp4', 'json'], resolution: 768 },
}, {
  file: myFile,
  onProgress: p => console.log(p.stage, Math.round(p.frac * 100) + '%'),
});

console.log(manifest.artifacts);       // hashes + sizes
```

---

## 3a. Customization API (v4.4)

Extend the render without forking. Everything here is additive and inert until used.

### Custom layers — `TP.registerLayer(layer)`

Draw your own overlay on top of every composited frame (grids, edges, watermarks…).

```ts
TP.registerLayer({
  id: 'grid',                 // unique; re-registering by id replaces
  name: 'Reference grid',     // shown in the Plugins panel
  enabled: true,
  draw(ctx, { fi, w, h, state, frame }) {
    // ctx: the 2D export/preview context (already save()/restore()-wrapped)
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    for (let x = 0; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  },
});
TP.unregisterLayer('grid');
TP.plugins            // { layers:[…], exporters:[…] }  (read-only snapshot)
```

Layers run at the end of the composite for **every** frame (live preview *and*
export), in registration order, only while `enabled`.

### Custom exporters — `TP.registerExporter(exp)` / `TP.runExporter(id, opts?)`

Package frames into your own format, reusing the exact frame harness the built-in
MP4/PNG exporters use.

```ts
TP.registerExporter({
  id: 'frames-bin',
  name: 'Raw frame dump',
  async run(api) {
    // api = { range, fps, dims:[w,h], state, resolveDep, status, forEachFrame, emit }
    await api.forEachFrame((canvas, i, w, h) => { /* per-frame work */ });
    api.emit(bytes, 'out.bin', 'application/octet-stream'); // triggers a download
  },
});
await TP.runExporter('frames-bin');
```

`resolveDep(url)` routes a known upstream dependency URL through the local vendor resolver, so custom exporters can keep working in offline mode.

### Preset library — `TP.presets`

Save/restore the whole control panel as named presets (persisted in localStorage;
also surfaced in the UI Presets panel).

```ts
TP.presets.list()                 // [{ id, name, patch }]
TP.presets.save('My look')        // capture the current controls
TP.presets.apply('my-look')       // re-apply (validated through tp.job/v1)
TP.presets.remove('my-look')
TP.presets.export()               // portable JSON string
TP.presets.import(jsonString)     // merge presets from JSON
```

Preset patches are normalized through `tp.job/v1`, so an out-of-range value can
never corrupt the panel.

### Offline engine — `TP.offline`

```ts
TP.offline.enabled       // is the vendored dependency path active?
TP.offline.vendorBase    // './vendor/'
TP.offline.set(true)     // persist the choice and reload
```

Also toggled from **Settings → “Offline engine (vendored deps)”** in the UI and
via the `?offline=1` URL parameter. Run `npm ci` and `npm run vendor:prepare` for locked runtime files, then `npm run setup` once to download optional model files. See `vendor/README.md`.

---

## 4. `postMessage` channel

Drive the app headless or from a parent frame — no DOM access required.

```js
iframe.contentWindow.postMessage({ type: 'tp:run', id: 1, job }, '*');

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'tp:progress') console.log(m.stage, m.frac);
  if (m.type === 'tp:result')   console.log('manifest', m.manifest);
  if (m.type === 'tp:error')    console.error(m.error);
});
```

Supported inbound messages: `tp:capabilities`, `tp:validate`, `tp:run` (all
carry an `id` echoed back on the reply). Blobs stay in-page; the reply carries
the manifest (with hashes) so a driver can pull artifacts via a download hook.

---

## 5. Result manifest (`tp.manifest/v1`)

Every run emits a deterministic, reproducible record: input SHA-256, the exact
normalized job, model + backend provenance, per-artifact SHA-256/size, capability
snapshot, and per-stage timings. See `tp.manifest.schema.json`.

---

## 6. Validate & test offline

```bash
npm test                         # unit and release-contract tests
node -e "console.log(require('./api/tp-spec.js').validateJob({depth:{engine:'x'}}))"
```

---

## 7. Ecosystem (shipped)

`tp.job/v1` is the seam the rest of the platform is built on — these all ship in the box now:

- **CLI** (`tp-cli`, Node + Playwright): loads the locally hosted browser app headlessly,
  submits a Job Spec over the `postMessage` channel, saves artifacts to disk.
  `node cli/tp-cli.mjs --help`.
- **MCP server** (`tp-mcp`): exposes `tp_validate_job`, `tp_normalize_job`,
  `tp_list_capabilities`, `tp_render_controls`, `tp_detect_poses`, `tp_bake_depth`,
  `tp_get_manifest` over JSON-RPC/stdio. See `MCP.md`.
- **Plugin API**: `TP.registerLayer()` / `TP.registerExporter()` + a preset
  library (§3a). New control types (edges, normals, optical flow, segmentation)
  become new layers/exporters without forking. See `PLUGINS.md`.
- **True-offline local runtime**: exact npm runtime packages are copied into `public/vendor/`; `npm run setup` downloads the pinned optional model files. After setup, the local app can run without network access (§3a `TP.offline`).
- **REST gateway and chunked export**: the loopback-first job gateway, bounded queue, and streaming/chunked exporters ship in `api/server/` and `api/exporters/`.

---

## 8. Local API - REST gateway (v1.0.0)

The same `tp.job/v1` contract is exposed over HTTP by a Node-core gateway
(`api/server/`, bin `tp-gateway`). It fronts a job queue + bounded worker pool
that drives the exact headless runner the CLI uses — one source of truth for
rendering.

```bash
# offline planner (no GPU/network) — great for wiring up a client
TP_RENDER_MODE=dryrun npm run gateway -- --port 8787
# real headless render
npm run gateway -- --mode real --app dist/app.html
```

The gateway binds to `127.0.0.1` by default. Non-loopback startup requires `TP_API_TOKEN`. Browser origins are limited to the configured local CORS allowlist, and `input.path` is disabled unless a trusted operator explicitly sets `TP_ALLOW_INPUT_PATH=1`. Delete a terminal job and its stored artifacts with `DELETE /v1/jobs/:id`.

| Method | Path | Notes |
|--------|------|-------|
| `GET`  | `/healthz` | liveness + queue stats |
| `GET`  | `/v1/capabilities` | real browser WebGPU/WebCodecs probe |
| `POST` | `/v1/jobs` | `{ "job": <tp.job/v1>, "input": { "name", "base64" } }` → `202 { id }` |
| `GET`  | `/v1/jobs` · `/v1/jobs/:id` | list · status (`queued\|running\|succeeded\|failed\|canceled`) |
| `GET`  | `/v1/jobs/:id/manifest` | `tp.manifest/v1` (409 until ready) |
| `GET`  | `/v1/jobs/:id/artifacts[/:name]` | metadata · raw bytes |
| `POST` | `/v1/jobs/:id/cancel` | cancel queued / mark running |

Auth: set `TP_API_TOKEN`, send `Authorization: Bearer <token>` on `/v1/*`.
Deploy + reproducibility gate: see `../deploy/README.md`.

## 9. Streaming / chunked export (v4.5)

For long clips, `api/exporters/chunked.js` registers a `chunked-frames`
exporter that walks the range through the standard harness and flushes one
bounded segment (a zip of PNGs) per chunk, using the deterministic
`api/chunking.js` planner (`TPChunking.planChunks`). Peak memory ≈ one chunk.

```js
// state.export.chunkFrames controls segment size (default 300)
await TP.runExporter('chunked-frames')
```

See `PLUGINS.md` for the `registerLayer` / `registerExporter` contracts and
`plugins/README.md` for the first-party example layers (edges / segmentation /
optical-flow).

## Numbered frame sequences & FFmpeg I/O (v5.1)

### In the app (browser)

- **Export PNG / JPEG / TIFF sequences** as zip archives named `{stem}_{format}_seq.zip`
  containing `frames/{stem}_{####}.ext` (pad + start configurable in Export settings).
- **Import sequence** loads a folder/multi-select/zip of numbered frames as a source timeline
  (natural numeric sort: `frame_2` before `frame_10`).
- **Import as depth** maps a grayscale sequence onto the In/Out range (Alt+drop).
- Drop multi-images onto the window = sequence import; Alt+drop = depth import.

### CLI (system FFmpeg)

```bash
# Video → numbered frames on disk
node api/cli/tp-frames-cli.mjs frames export input.mp4 --out ./frames --format png --stem shot --pad 4

# Numbered frames → video
node api/cli/tp-frames-cli.mjs frames import ./frames --out rebuild.mp4 --fps 24

# Transcode presets
node api/cli/tp-frames-cli.mjs convert input.mov --out out.mp4 --preset h264
node api/cli/tp-frames-cli.mjs convert input.mp4 --out out.mov --preset prores
```

Job Spec `output.format` now also accepts: `jpeg`, `tiff`, `openpose`, `webm`.
