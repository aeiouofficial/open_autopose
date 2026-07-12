#!/usr/bin/env node
import { access, readFile, stat } from "node:fs/promises"
import { constants } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const VENDOR = resolve(ROOT, "public", "vendor")
const requiredRuntime = [
  "three/three.module.js",
  "three/addons/controls/OrbitControls.js",
  "mediapipe/vision_bundle.mjs",
  "mediapipe/wasm/vision_wasm_internal.js",
  "mediapipe/wasm/vision_wasm_internal.wasm",
  "fflate/fflate.mjs",
  "mp4-muxer/mp4-muxer.mjs",
  "transformers/transformers.min.js",
  "onnxruntime/ort.webgpu.min.js",
  "runtime-manifest.json",
]
const models = [
  "models/pose_landmarker_full.task",
  "models/onnx-community/depth-anything-v2-small/config.json",
  "models/onnx-community/depth-anything-v2-small/preprocessor_config.json",
  "models/onnx-community/depth-anything-v2-small/onnx/model_quantized.onnx",
  "vda/vda_vits_encoder_518x910_fp16.onnx",
  "vda/vda_vits_head_T32_37x65_fp16.onnx",
]

let failed = false
for (const rel of requiredRuntime) {
  try {
    await access(resolve(VENDOR, rel), constants.R_OK)
    const s = await stat(resolve(VENDOR, rel))
    if (!s.size) throw new Error("empty")
  } catch (error) {
    failed = true
    console.error(`Missing required offline runtime file: public/vendor/${rel} (${error.message})`)
  }
}

let modelCount = 0
for (const rel of models) {
  try {
    const s = await stat(resolve(VENDOR, rel))
    if (s.size > 0) modelCount++
  } catch {}
}

if (failed) process.exit(1)
const manifest = JSON.parse(await readFile(resolve(VENDOR, "runtime-manifest.json"), "utf8"))
console.log(`Offline runtime verified (${manifest.files.length} checksummed files).`)
if (modelCount === models.length) console.log("All optional offline AI models are installed.")
else console.log(`Offline AI models: ${modelCount}/${models.length} present. Run \"npm run vendor:fetch-models\" once while online for full no-network inference.`)
