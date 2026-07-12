# Open AutoPose v1.0.0 - Install and Start

## 1. Run the app offline (no install needed)

This release ships a prebuilt `dist/`, so you can run the app immediately with only Node.js installed - there is no dependency download and no build step.

- Windows: double-click `Start_App.bat`
- macOS/Linux: run `./Start_App.sh`
- From a terminal (any OS): `npm run serve` (equivalently `node scripts/serve-dist.mjs`)

Then open `http://127.0.0.1:4173`.

> You do NOT need `npm install` to use the app. Dependencies are only for the optional developer tools in section 2.

## 2. Optional developer setup (dev server, production build, tests, gateway)

These extra tools need a one-time dependency install with internet access:

```bash
npm install
```

The committed `package-lock.json` provides reproducible installs (use `npm ci` for clean installs).

> If `npm install`/`npm ci` fails with `Exit handler never called!`, that is a known npm/Node defect (not a package fault): npm crashed out-of-band and could not report the real error. Update to Node.js 20 LTS or the latest Node.js 22 LTS and retry, and avoid running from a backup/removable/synced drive. You do not need this step to run the app - see section 1.

### Development host

```bash
npm run dev
```

Open `http://127.0.0.1:5173`.

### Rebuild the production output

```bash
npm run build
npm run serve
```

Open `http://127.0.0.1:4173`. The shipped `dist/` already contains this exact output, so this is only needed if you change the source.

## 3. AI models: automatic on first use

You do not need to pre-install the AI models. The first time you run pose tracking or Consistent depth, the local host fetches the required model weights from their pinned upstream sources, caches them into `dist/vendor/`, and serves them. **Every launch after that is fully offline** - no network access is needed again.

- The first launch that uses a model needs an internet connection once.
- Cached models persist inside the extracted folder, so relaunching (or shipping an already-run folder) needs no network.
- The runtime JavaScript/WASM is always served from the bundled `dist/vendor/` and never contacts a CDN.

Optional (advanced): to pre-download every model without launching the app, run `node vendor/fetch-vendor.mjs --models-only` (Node only, no `npm install` required). That populates `public/vendor/`; copy `public/vendor/models` and `public/vendor/vda` into `dist/vendor/` to have the prebuilt host serve them.

## 4. Tests

```bash
npm test
npm run smoke
npm run probe
npm run test:all
```

The probe and real-render CLI require Chrome/Edge or a Playwright Chromium installation. Install Playwright Chromium with:

```bash
npm run setup:test-browser
```

## 5. Optional FFmpeg workflows

Install `ffmpeg` and `ffprobe` on `PATH`, then use:

```bash
npm run frames -- --help
```

## 6. Local gateway (optional, advanced)

The REST gateway needs the section 2 dependency install (it uses Playwright). Then:

```bash
npm run gateway
```

Windows users may run `Start_Gateway.bat`; macOS/Linux users `./Start_Gateway.sh`. The gateway defaults to `http://127.0.0.1:8787`. Browser CORS is restricted to the local app origins, and filesystem `input.path` requests are disabled by default. To expose it beyond the local machine, explicitly set `TP_API_TOKEN` and pass a non-loopback `--host` value. Only trusted local automation should enable `TP_ALLOW_INPUT_PATH=1`.

## Troubleshooting

- The offline app needs only Node.js. If `npm install` fails, you can still run it via section 1.
- Do not open `app.html` directly with `file://`; use `npm run serve` (or `npm run dev`).
- Run `npm run vendor:verify` to check local runtime files.
- Run `npm run vendor:fetch-models -- --force` to replace incomplete model downloads.
- WebGPU and WebCodecs availability varies by browser, driver, and GPU.
