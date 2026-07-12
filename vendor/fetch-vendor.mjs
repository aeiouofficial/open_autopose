#!/usr/bin/env node
// Downloads only the AI model files that cannot be sourced from npm.
// JavaScript/WASM runtime dependencies are prepared from exact package-lock
// versions by `npm run vendor:prepare`.
import { createHash } from "node:crypto"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = resolve(ROOT, "public", "vendor")
const DA_REV = "0d8d94ea44f483e26c9c33dad1a97c453ef9b80c"
const VDA_REV = "9360ac2b147da3ca220fb9e1bb55600fd7e3d9aa"
const MP_BASE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker"
const VP_REV = "bbebbddd612af2728539103dd5b903a4f5a2da4c"
const VP_BASE = `https://huggingface.co/onnx-community/vitpose-base-simple/resolve/${VP_REV}`
const DA_BASE = `https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/${DA_REV}`
const VDA_BASE = `https://huggingface.co/TheoreticallyTim/theoreticallypose-vda/resolve/${VDA_REV}`

const PLAN = [
  ["core", `${MP_BASE}/pose_landmarker_full/float16/1/pose_landmarker_full.task`, "models/pose_landmarker_full.task", true],
  ["core-extra", `${MP_BASE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`, "models/pose_landmarker_lite.task", false],
  ["core-extra", `${MP_BASE}/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task`, "models/pose_landmarker_heavy.task", false],
  ["fast", `${DA_BASE}/config.json`, "models/onnx-community/depth-anything-v2-small/config.json", true],
  ["fast", `${DA_BASE}/preprocessor_config.json`, "models/onnx-community/depth-anything-v2-small/preprocessor_config.json", true],
  ["fast", `${DA_BASE}/onnx/model_quantized.onnx`, "models/onnx-community/depth-anything-v2-small/onnx/model_quantized.onnx", true],
  ["vitpose", `${VP_BASE}/config.json`, "models/onnx-community/vitpose-base-simple/config.json", false],
  ["vitpose", `${VP_BASE}/preprocessor_config.json`, "models/onnx-community/vitpose-base-simple/preprocessor_config.json", false],
  ["vitpose", `${VP_BASE}/onnx/model.onnx`, "models/onnx-community/vitpose-base-simple/onnx/model.onnx", false],
  ["vda", `${VDA_BASE}/vda_vits_encoder_518x910_fp16.onnx`, "vda/vda_vits_encoder_518x910_fp16.onnx", true],
  ["vda", `${VDA_BASE}/vda_vits_head_T32_37x65_fp16.onnx`, "vda/vda_vits_head_T32_37x65_fp16.onnx", true],
]

const args = process.argv.slice(2)
const only = (args.find((arg) => arg.startsWith("--only=")) || "").split("=")[1] || null
const force = args.includes("--force")
const list = args.includes("--list")
const selected = PLAN.filter(([category]) => !only || category === only || (only === "core" && category === "core-extra"))

if (list) {
  for (const [category, url, dest, required] of selected) {
    console.log(`[${category}]${required ? "*" : " "} ${dest}\n  ${url}`)
  }
  process.exit(0)
}

async function exists(path) {
  try { return (await stat(path)).size > 0 } catch { return false }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

const report = []
let failures = 0
for (const [category, url, dest, required] of selected) {
  const target = resolve(OUT, dest)
  if (!force && await exists(target)) {
    const size = (await stat(target)).size
    report.push({ category, dest, url, status: "existing", bytes: size, sha256: await sha256(target) })
    console.log(`= ${dest} (${(size / 1048576).toFixed(1)} MB)`)
    continue
  }
  const temp = `${target}.part`
  try {
    await mkdir(dirname(target), { recursive: true })
    await rm(temp, { force: true })
    const response = await fetch(url, { redirect: "follow" })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const chunks = []
    let bytes = 0
    for await (const chunk of response.body) {
      chunks.push(chunk)
      bytes += chunk.length
      process.stdout.write(`\r↓ ${dest} ${(bytes / 1048576).toFixed(1)} MB`)
    }
    process.stdout.write("\n")
    await writeFile(temp, Buffer.concat(chunks))
    await rename(temp, target)
    const hash = await sha256(target)
    report.push({ category, dest, url, resolvedUrl: response.url, status: "downloaded", bytes, sha256: hash })
    console.log(`✓ ${dest} sha256=${hash}`)
  } catch (error) {
    await rm(temp, { force: true })
    report.push({ category, dest, url, status: "failed", required, error: error.message })
    console.error(`${required ? "✗" : "⚠"} ${dest}: ${error.message}`)
    if (required) failures++
  }
}

await mkdir(OUT, { recursive: true })
await writeFile(resolve(OUT, "model-lock.json"), JSON.stringify({
  format: "open-autopose.model-lock/v1",
  generatedAt: new Date().toISOString(),
  revisions: { depthAnything: DA_REV, videoDepthAnything: VDA_REV, mediaPipePose: "float16/1" },
  files: report,
}, null, 2) + "\n")

if (failures) process.exit(1)
console.log("Offline model download complete. Subsequent dev/build/serve runs require no model network access.")
