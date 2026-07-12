# Open AutoPose — CLI & MCP (Tier 1)

Tier 1 turns the `tp.job/v1` contract into two real entry points that sit on top
of the **exact same app** the human uses:

- **`tp-cli`** — a scriptable command line.
- **`tp-mcp`** — an MCP server (stdio) for Claude Desktop, Cursor, and any other
  MCP client.

Neither re-implements the pipeline. Validation/normalization use the
dependency-free validator (`tp-spec.js`); rendering drives the real locally hosted browser app headlessly through Playwright + Chromium (`runner/browser.mjs`).

```text
api/
  runner/browser.mjs   shared Playwright bridge (probeCapabilities, runJob)
  cli/tp-cli.mjs       command line
  mcp/tp-mcp.mjs       MCP stdio server (JSON-RPC 2.0)
  tests/smoke.mjs      offline smoke battery (node tests/smoke.mjs)
```

## Why an external server (the honest architecture)

The browser page is not itself an MCP stdio server. `tp-mcp` is a small Node process that:

1. speaks MCP over stdio to the client, and
2. launches **headless Chromium**, loads the real app, and calls `window.TP`.

The app stays the single source of truth for every pixel; the server is glue.

## Requirements

- Node.js 20.19+ or 22.12+ and Playwright with a Chromium binary. Run `npm run setup:test-browser`, use a compatible system Chrome/Edge, or set `TP_CHROMIUM=/path/to/chrome`.
- Run `npm run build` before real CLI/MCP rendering. Run `npm run setup` once if pose or depth model files must work without network access.
- GPU requirements depend on the job: Consistent VDA depth needs WebGPU; browser MP4 export needs WebCodecs; pose-only and validation workflows have lighter requirements.
- `validate`, `normalize`, and `get_manifest` work without GPU access. The capability probe needs a launchable browser but no model download.

## CLI

```bash
node cli/tp-cli.mjs validate      examples/pose-openpose.job.json
node cli/tp-cli.mjs normalize     examples/depth-vda-composite.job.json
node cli/tp-cli.mjs capabilities  --json
node cli/tp-cli.mjs render clip.mp4 --job examples/pose-openpose.job.json --out ./out
node cli/tp-cli.mjs selftest      # offline smoke battery
```

`render` writes each artifact plus a `manifest.json` into `--out`.

## MCP tools

| Tool | Needs browser | Additional requirement |
|------|:---:|:---:|
| `tp_validate_job` | no | none |
| `tp_normalize_job` | no | none |
| `tp_get_manifest` | no | existing manifest |
| `tp_list_capabilities` | yes | launchable Chrome/Edge/Chromium |
| `tp_render_controls` | yes | requirements depend on requested layers/export |
| `tp_detect_poses` | yes | installed pose model |
| `tp_bake_depth` | yes | installed depth model; WebGPU for VDA |

### Register with an MCP client

Claude Desktop (`claude_desktop_config.json`) or any MCP client:

```jsonc
{
  "mcpServers": {
    "open-autopose": {
      "command": "node",
      "args": ["/absolute/path/to/OpenAutoPose_v1.0.0/api/mcp/tp-mcp.mjs"],
      "env": { "TP_CHROMIUM": "/usr/bin/google-chrome" }
    }
  }
}
```

### Protocol

Newline-delimited JSON-RPC 2.0 on stdio (the MCP stdio transport). Implemented
methods: `initialize`, `ping`, `tools/list`, `tools/call`. Diagnostics go to
stderr; stdout carries only protocol frames.

Quick manual check:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node mcp/tp-mcp.mjs
```

## What is smoke-tested vs. not

`node tests/smoke.mjs` (also `tp-cli selftest`) asserts, offline:

- the validator + all bundled examples;
- the **MCP server** over real stdio JSON-RPC (initialize / tools/list /
  tools/call for the offline tools, including the error path);
- a **real Chromium capability probe**;
- that the app's embedded `TPSpec` classic script **executes in a real browser**.

It intentionally **SKIPs** (does not fake) the full `TP.run` render, which needs
network + GPU. On a connected Chrome/Edge box the same suite reports `window.TP`
up and the render path becomes live.
