# Offline runtime and model assets

`npm run vendor:prepare` copies browser JavaScript and WASM files from the exact dependency versions recorded in the root `package-lock.json` into `public/vendor/`.

```bash
npm run vendor:prepare
npm run vendor:verify
```

AI model weights are not bundled in the source archive. Download the versioned Small models once while online:

```bash
npm run vendor:fetch-models
```

Available filters:

```bash
node vendor/fetch-vendor.mjs --list
node vendor/fetch-vendor.mjs --only=core
node vendor/fetch-vendor.mjs --only=fast
node vendor/fetch-vendor.mjs --only=vda
node vendor/fetch-vendor.mjs --force
```

The downloader writes `public/vendor/model-lock.json` with the resolved URL, file size, and SHA-256 checksum for every downloaded file. The Vite development server and production build serve these files from `/vendor/`.
