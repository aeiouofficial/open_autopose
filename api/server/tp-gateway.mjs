#!/usr/bin/env node
// =============================================================================
// tp-gateway — start the Open AutoPose REST gateway (Tier 3)
// -----------------------------------------------------------------------------
// Usage:
//   tp-gateway [--port 8787] [--data <dir>] [--concurrency N]
//              [--mode real|dryrun] [--app <html>] [--host 127.0.0.1]
//
// Env: PORT, TP_HOST, TP_RENDER_MODE, TP_CONCURRENCY, TP_API_TOKEN, TP_CHROMIUM,
//      TP_CORS_ORIGINS, TP_ALLOW_INPUT_PATH
// =============================================================================

import { createGateway, GATEWAY_VERSION } from "./gateway.mjs"

function parseArgs(argv) {
	const out = {}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a.startsWith("--")) {
			const k = a.slice(2), n = argv[i + 1]
			if (n === undefined || n.startsWith("--")) out[k] = true
			else { out[k] = n; i++ }
		}
	}
	return out
}

const args = parseArgs(process.argv.slice(2))
if (args.version) { process.stdout.write(GATEWAY_VERSION + "\n"); process.exit(0) }
if (args.help) {
	process.stdout.write(
		`tp-gateway ${GATEWAY_VERSION}\n\n` +
		"  --port N          listen port (default 8787 / $PORT)\n" +
		"  --host ADDRESS    bind address (default 127.0.0.1 / $TP_HOST)\n" +
		"  --data <dir>      job + artifact storage dir\n" +
		"  --concurrency N   worker pool size (default 1 / $TP_CONCURRENCY)\n" +
		"  --mode <m>        real | dryrun (default $TP_RENDER_MODE or real)\n" +
		"  --app <html>      path to built app HTML (default dist/app.html)\n",
	)
	process.exit(0)
}

const gw = createGateway({
	dataDir: args.data,
	concurrency: args.concurrency ? Number(args.concurrency) : undefined,
	mode: args.mode,
	appPath: args.app,
})

const host = String(args.host || process.env.TP_HOST || "127.0.0.1")
const loopback = new Set(["127.0.0.1", "localhost", "::1"])
if (!loopback.has(host) && !process.env.TP_API_TOKEN) {
	throw new Error("Refusing non-loopback gateway binding without TP_API_TOKEN")
}
const { url } = await gw.listen(args.port ? Number(args.port) : undefined, host)
process.stdout.write(`tp-gateway ${GATEWAY_VERSION} listening on ${url} (mode=${gw.mode})\n`)

for (const sig of ["SIGINT", "SIGTERM"]) {
	process.on(sig, async () => { await gw.close(); process.exit(0) })
}
