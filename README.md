# Open AutoPose
<img width="2541" height="943" alt="image" src="https://github.com/user-attachments/assets/60c2e5d0-bdbe-4ebd-ac07-2dc261145187" />

**Local-first browser video control toolset** for pose, silhouette, depth, and ControlNet-oriented workflows.

![version](https://img.shields.io/badge/version-1.0.0-teal) ![license](https://img.shields.io/badge/license-MIT-blue) ![node](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)

## Features

- MediaPipe pose tracking with Lite, Full, and Heavy model tiers
- Skeleton, silhouette, Fast depth, and temporally consistent VDA depth layers
- Manual joint editing, pose library, temporal smoothing, markers, and compare mode
- OpenPose/ControlNet JSON import and export
- Numbered PNG, JPEG, and TIFF sequence import/export
- FFmpeg-backed H.264, ProRes, WebM, GIF, and frame-sequence workflows
- Batch queue, webcam preview, BVH export, remappable keybinds, and project files
- CLI, MCP server, and loopback-only REST gateway over `tp.job/v1`

## Requirements

- Node.js **20.19+** or **22.12+**
- Current Chrome or Microsoft Edge for GPU/WebCodecs features
- Optional: system `ffmpeg` and `ffprobe` for CLI media conversion

## Local development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The local app automatically uses vendored npm runtime files and does not require Docker.

AI model weights are provisioned automatically. The first time pose tracking or Consistent depth runs, the app fetches the pinned MediaPipe, Depth Anything Small, and Video Depth Anything Small model files from their upstream sources, caches them locally, and reuses the cache on every later launch with no network access. Model binaries are intentionally not redistributed in the source release, so the first model-using launch needs internet once.

To pre-download the models without launching the app (optional, Node only, no `npm install`): `node vendor/fetch-vendor.mjs --models-only`.

## Production build and local hosting

```bash
npm run build
npm run serve
```

Open `http://127.0.0.1:4173`. The production site is written to `dist/` and can also be served by any static web host.

`npm run preview` is available for inspecting the latest build with Vite. It is a preview command, while `npm run serve` is the included minimal localhost-only static host.

## Main scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite development server on `127.0.0.1` |
| `npm run build` | Prepare vendored runtime files and build `dist/` |
| `npm run serve` | Host `dist/` locally on `127.0.0.1:4173` |
| `npm run start` | Build and then host the production output |
| `npm run setup` | Optional: pre-download AI models (dev; otherwise they fetch on first use) |
| `npm test` | Unit and release checks |
| `npm run smoke` | Offline API/browser-shell smoke battery |
| `npm run probe` | Portable browser capability probe |
| `npm run test:all` | Unit, smoke, probe, build, and local-host checks |

## CLI and FFmpeg

```bash
npm run frames -- --help
node api/cli/tp-cli.mjs validate api/examples/pose-openpose.job.json
node api/cli/tp-cli.mjs capabilities
```

Example with your own clip:

```bash
node api/cli/tp-frames-cli.mjs frames export ./input.mp4 --out ./frames --format png --stem input
node api/cli/tp-frames-cli.mjs frames import ./frames --out ./rebuilt.mp4 --fps 24
node api/cli/tp-frames-cli.mjs convert ./input.mp4 --out ./output.webm --preset webm
```

## Gateway and MCP

```bash
npm run gateway
npm run mcp
```

The gateway binds to `127.0.0.1` by default. A non-loopback bind is rejected unless `TP_API_TOKEN` is configured. Browser CORS is limited to the local dev/production origins, `input.path` is disabled by default, and terminal jobs can be deleted with `DELETE /v1/jobs/:id`.

## Offline architecture

JavaScript and WASM runtime dependencies are copied from exact versions in `package-lock.json` by `npm run vendor:prepare`. A checksummed runtime manifest is written to `public/vendor/runtime-manifest.json`. Model downloads use versioned URLs and produce `public/vendor/model-lock.json` containing resolved URLs, sizes, and SHA-256 hashes.

## Distribution notes

Third-party runtime and model notices are listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). The bundled source package does not include AI model weights or an unverified demonstration video. See [PRIVACY.md](./PRIVACY.md), [SECURITY.md](./SECURITY.md), and [SUPPORT.md](./SUPPORT.md) for distribution-facing guidance.

## License

MIT - see [LICENSE](./LICENSE).

## Hardware boundary

WebGPU depth, WebCodecs export, and webcam capture depend on the browser and physical hardware. Verify these on your target Windows/macOS/Linux hardware before publishing a build.
