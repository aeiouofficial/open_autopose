#!/usr/bin/env node
import { cp, copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const NM = resolve(ROOT, "node_modules")
const OUT = resolve(ROOT, "public", "vendor")

const copies = [
  ["three/build/three.module.js", "three/three.module.js"],
  ["three/examples/jsm/controls/OrbitControls.js", "three/addons/controls/OrbitControls.js"],
  ["@mediapipe/tasks-vision/vision_bundle.mjs", "mediapipe/vision_bundle.mjs"],
  ["@mediapipe/tasks-vision/wasm", "mediapipe/wasm", true],
  ["fflate/esm/browser.js", "fflate/fflate.mjs"],
  ["mp4-muxer/build/mp4-muxer.mjs", "mp4-muxer/mp4-muxer.mjs"],
  ["@huggingface/transformers/dist/transformers.min.js", "transformers/transformers.min.js"],
  ["@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs", "transformers/ort-wasm-simd-threaded.jsep.mjs"],
  ["@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm", "transformers/ort-wasm-simd-threaded.jsep.wasm"],
  ["onnxruntime-web/dist/ort.webgpu.min.js", "onnxruntime/ort.webgpu.min.js"],
  ["onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs", "onnxruntime/ort-wasm-simd-threaded.jsep.mjs"],
  ["onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm", "onnxruntime/ort-wasm-simd-threaded.jsep.wasm"],
]

async function copyEntry(srcRel, dstRel, directory = false) {
  const src = resolve(NM, srcRel)
  const dst = resolve(OUT, dstRel)
  await mkdir(dirname(dst), { recursive: true })
  if (directory) await cp(src, dst, { recursive: true, force: true })
  else await copyFile(src, dst)
}

for (const entry of copies) await copyEntry(...entry)

const packages = [
  "three",
  "@mediapipe/tasks-vision",
  "@huggingface/transformers",
  "fflate",
  "mp4-muxer",
  "onnxruntime-web",
]
const versions = {}
for (const name of packages) {
  const pkg = JSON.parse(await readFile(resolve(NM, name, "package.json"), "utf8"))
  versions[name] = pkg.version
}

const manifestFiles = []
for (const [, dstRel, directory] of copies) {
  if (directory) continue
  const bytes = await readFile(resolve(OUT, dstRel))
  manifestFiles.push({
    path: dstRel.replaceAll("\\", "/"),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  })
}
await writeFile(resolve(OUT, "runtime-manifest.json"), JSON.stringify({
  format: "open-autopose.vendor-runtime/v1",
  generatedAt: new Date().toISOString(),
  source: "exact npm packages from package-lock.json",
  versions,
  files: manifestFiles,
}, null, 2) + "\n")

console.log(`Prepared ${copies.length} offline runtime entries in public/vendor.`)
