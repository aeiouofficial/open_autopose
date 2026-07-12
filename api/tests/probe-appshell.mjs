// Standalone driver: runs the shipped smoke suite's C+D headless browser slice
// against the shipped app shell, using the app's OWN runner/browser.mjs.
// Adds a page-exception / console-error counter for a reproducible number.
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { readFileSync } from "node:fs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const API = resolve(__dirname, "..")
const require = createRequire(import.meta.url)
const spec = require(resolve(API, "tp-spec.js"))

let pass = 0, fail = 0, skip = 0
const ok = (m) => { pass++; console.log("  \u2714 " + m) }
const no = (m) => { fail++; console.log("  \u2716 " + m) }
const sk = (m) => { skip++; console.log("  \u26a0 SKIP " + m) }
const assert = (c, m) => c ? ok(m) : no(m)

const pageErrors = []
const consoleErrors = []

const mod = await import("../runner/browser.mjs")

console.log("C. Headless browser capability probe (offline)")
try {
	const caps = await mod.probeCapabilities()
	assert(typeof caps.webgpu === "boolean" && typeof caps.webcodecs === "boolean", "probe returns boolean feature flags")
	assert(Array.isArray(caps.depthEngines) && caps.depthEngines.includes("fast"), "depthEngines includes 'fast'")
	console.log(`    (this box: webgpu=${caps.webgpu} webcodecs=${caps.webcodecs} chromium=${caps.chromium || "?"})`)
} catch (e) { sk("capability probe could not launch chromium: " + e.message) }

console.log("D. Headless browser loads the shipped app shell (offline)")
try {
	const appHtml = readFileSync(mod.DEFAULT_APP_PATH, "utf8")
	console.log("    (app shell: " + mod.DEFAULT_APP_PATH + ")")
	const moduleAt = appHtml.indexOf('<script type="module">')
	const appShellHtml = (moduleAt >= 0 ? appHtml.slice(0, moduleAt) : appHtml) + "</body></html>"
	const browser = await mod.launchBrowser()
	try {
		const page = await browser.newPage()
		page.on("pageerror", (err) => pageErrors.push(String(err && err.message || err)))
		page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()) })
		await page.goto("about:blank?offline=0")
		await page.setContent(appShellHtml, { waitUntil: "domcontentloaded" })
		const hasSpec = await page.evaluate("typeof globalThis.TPSpec !== 'undefined'")
		assert(hasSpec === true, "embedded TPSpec classic script executes in a real browser")
		if (hasSpec) {
			const v = await page.evaluate("globalThis.TPSpec.validateJob({output:{format:'png'}}).valid")
			assert(v === true, "in-browser TPSpec.validateJob works")
		}
		const duplicateIds = await page.evaluate(() => {
			const ids = [...document.querySelectorAll("[id]")].map((el) => el.id)
			return ids.filter((id, i) => ids.indexOf(id) !== i)
		})
		assert(duplicateIds.length === 0, "shipped app shell has no duplicate DOM ids")
		// give any deferred/microtask errors a moment to surface
		await page.waitForTimeout(300)
		sk("full render acceptance requires installed model files plus a WebGPU/WebCodecs-capable browser")
	} finally { await browser.close() }
} catch (e) { no("real-app load could not run: " + e.message) }

console.log("\n--- page exception / console-error counter ---")
console.log("  browser page exceptions (uncaught): " + pageErrors.length)
if (pageErrors.length) pageErrors.forEach((m, i) => console.log("    [pageerror " + (i + 1) + "] " + m))
console.log("  console.error messages: " + consoleErrors.length)
if (consoleErrors.length) consoleErrors.forEach((m, i) => console.log("    [console.error " + (i + 1) + "] " + m))

console.log(`\nresult: ${pass} passed, ${fail} failed, ${skip} skipped`)
process.exit(fail === 0 ? 0 : 1)
