#!/usr/bin/env node
import http from "node:http"
import { createReadStream } from "node:fs"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { extname, resolve, sep, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DIST = resolve(ROOT, "dist")
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".task": "application/octet-stream",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

// --- First-launch model provisioning -------------------------------------
// The JS/WASM runtime ships vendored in dist/vendor and is served straight
// from disk (fully offline). The large AI model weights are NOT bundled; on
// the first request for one, we fetch it from its upstream source, cache it to
// dist/vendor, and serve it. Every later launch reads it from disk with no
// network access. Pinned revisions match vendor/fetch-vendor.mjs.
const MP_BASE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker"
const DA_REV = "0d8d94ea44f483e26c9c33dad1a97c453ef9b80c"
const VDA_REV = "9360ac2b147da3ca220fb9e1bb55600fd7e3d9aa"
const DA_BASE = `https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/${DA_REV}`
const VDA_BASE = `https://huggingface.co/TheoreticallyTim/theoreticallypose-vda/resolve/${VDA_REV}`

const VP_REV = "bbebbddd612af2728539103dd5b903a4f5a2da4c"
const VP_BASE = `https://huggingface.co/onnx-community/vitpose-base-simple/resolve/${VP_REV}`

function remoteModelUrl(pathname) {
  let m = pathname.match(/^\/vendor\/models\/pose_landmarker_(full|lite|heavy)\.task$/)
  if (m) return `${MP_BASE}/pose_landmarker_${m[1]}/float16/1/pose_landmarker_${m[1]}.task`
  m = pathname.match(/^\/vendor\/models\/onnx-community\/depth-anything-v2-small\/(.+)$/)
  if (m) return `${DA_BASE}/${m[1]}`
  m = pathname.match(/^\/vendor\/models\/onnx-community\/vitpose-base-simple\/(.+)$/)
  if (m) return `${VP_BASE}/${m[1]}`
  m = pathname.match(/^\/vendor\/vda\/(.+)$/)
  if (m) return `${VDA_BASE}/${m[1]}`
  return null
}

const inFlight = new Map()
// Returns { ok:true } once the file exists on disk, or { ok:false, status, message }.
async function provisionModel(pathname, file) {
  const remote = remoteModelUrl(pathname)
  if (!remote) return { ok: false, status: 404, message: "Not found" }
  if (inFlight.has(file)) return inFlight.get(file)
  const task = (async () => {
    const temp = `${file}.part`
    try {
      console.log(`[tp] first-launch fetch: ${pathname}\n      <- ${remote}`)
      const response = await fetch(remote, { redirect: "follow" })
      if (!response.ok || !response.body) {
        // Pass upstream 404s through so optional files are treated as absent.
        return { ok: false, status: response.status === 404 ? 404 : 502, message: `Upstream HTTP ${response.status}` }
      }
      await mkdir(dirname(file), { recursive: true })
      await rm(temp, { force: true })
      const chunks = []
      for await (const chunk of response.body) chunks.push(chunk)
      await writeFile(temp, Buffer.concat(chunks))
      await rename(temp, file)
      console.log(`[tp] cached model to disk: ${pathname} (offline from now on)`)
      return { ok: true }
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      return {
        ok: false,
        status: 503,
        message: `Could not fetch ${pathname} from its source. The first launch needs internet to download the AI models (they are cached for offline use afterwards). Details: ${error.message}`,
      }
    } finally {
      inFlight.delete(file)
    }
  })()
  inFlight.set(file, task)
  return task
}

function safePath(pathname) {
  const decoded = decodeURIComponent(pathname).replaceAll("\\", "/")
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "")
  const full = resolve(DIST, rel)
  if (full !== DIST && !full.startsWith(DIST + sep)) return null
  return full
}

function sendFile(res, file, info) {
  res.writeHead(200, {
    "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
    "content-length": info.size,
    "cache-control": "no-cache",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
  })
  createReadStream(file).pipe(res)
}

export function createStaticServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1")
      let file = safePath(url.pathname)
      if (!file) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" })
        return res.end("Bad path")
      }
      let info
      try {
        info = await stat(file)
      } catch {
        // Not on disk: if it is a known model file, fetch + cache it on first use.
        const provisioned = await provisionModel(url.pathname, file)
        if (provisioned.ok) {
          info = await stat(file)
          return sendFile(res, file, info)
        }
        res.writeHead(provisioned.status, { "content-type": "text/plain; charset=utf-8" })
        return res.end(provisioned.message)
      }
      if (info.isDirectory()) {
        file = resolve(file, "index.html")
        info = await stat(file)
      }
      return sendFile(res, file, info)
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
      res.end(`Internal server error: ${error.message}`)
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv.find((value) => value.startsWith("--port="))
  const port = arg ? Number(arg.split("=")[1]) : Number(process.env.PORT || 4173)
  const host = process.env.HOST || "127.0.0.1"
  const server = createStaticServer()
  server.listen(port, host, () => {
    const address = server.address()
    console.log(`Open AutoPose local host: http://${host}:${address.port}`)
  })
}
