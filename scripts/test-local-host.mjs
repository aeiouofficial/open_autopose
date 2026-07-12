#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises"
import { extname, resolve, sep } from "node:path"
import { launchBrowser } from "../api/runner/browser.mjs"
import { createStaticServer } from "./serve-dist.mjs"

const DIST = resolve(new URL("../dist/", import.meta.url).pathname)
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
}

const server = createStaticServer()
await new Promise((resolveListen, reject) => {
  server.once("error", reject)
  server.listen(0, "127.0.0.1", resolveListen)
})
const port = server.address().port

try {
  for (const path of ["/", "/app.html", "/vendor/three/three.module.js", "/vendor/mediapipe/vision_bundle.mjs"]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`)
    if (!response.ok || !(await response.arrayBuffer()).byteLength) {
      throw new Error(`Local static host failed for ${path}: HTTP ${response.status}`)
    }
  }

  const browser = await launchBrowser()
  const pageErrors = []
  const consoleErrors = []
  try {
    const context = await browser.newContext()
    await context.route("https://tp.local/**", async (route) => {
      const url = new URL(route.request().url())
      const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "")
      const file = resolve(DIST, rel)
      if (file !== DIST && !file.startsWith(DIST + sep)) return route.fulfill({ status: 400, body: "bad path" })
      try {
        const info = await stat(file)
        if (!info.isFile()) throw new Error("not a file")
        return route.fulfill({
          status: 200,
          contentType: MIME[extname(file).toLowerCase()] || "application/octet-stream",
          headers: {
            "cross-origin-opener-policy": "same-origin",
            "cross-origin-embedder-policy": "require-corp",
          },
          body: await readFile(file),
        })
      } catch {
        return route.fulfill({ status: 404, body: "not found" })
      }
    })

    const page = await context.newPage()
    page.on("pageerror", (error) => pageErrors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    await page.goto("about:blank?offline=1")
    const appHtml = (await readFile(resolve(DIST, "app.html"), "utf8")).replace("<head>", "<head><base href=\"https://tp.local/\">")
    await page.setContent(appHtml, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => window.TP?.version === "v1.0.0", null, { timeout: 30000 })
    const state = await page.evaluate(() => ({
      version: window.TP.version,
      offline: window.__TP_OFFLINE,
      appState: typeof window.__tp !== "undefined",
      duplicateIds: (() => {
        const ids = [...document.querySelectorAll("[id]")].map((node) => node.id)
        return ids.filter((id, index) => ids.indexOf(id) !== index)
      })(),
    }))
    if (!state.offline || state.version !== "v1.0.0" || !state.appState || state.duplicateIds.length) {
      throw new Error(`Unexpected app state: ${JSON.stringify(state)}`)
    }
    if (pageErrors.length || consoleErrors.length) {
      throw new Error(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`)
    }
    console.log("Local host passed: HTTP files served, offline module UI loaded, window.TP ready, 0 browser errors.")
    await context.close()
  } finally {
    await browser.close()
  }
} finally {
  await new Promise((resolveClose) => server.close(resolveClose))
}
