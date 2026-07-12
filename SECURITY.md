# Security

## Safe defaults

- Development, production-static, and gateway servers bind to loopback by default.
- A non-loopback gateway bind requires `TP_API_TOKEN`.
- Do not expose Vite's development or preview server directly to the public internet.
- Keep Node.js, Chrome/Edge, GPU drivers, FFmpeg, and npm dependencies current within the supported version range.

## Reporting a vulnerability

Do not publish an unpatched vulnerability or private user data in a public issue. Send the report through the seller's private support or repository security-reporting channel with reproduction steps, affected version, and impact. The distributor must add a concrete monitored contact before public sale.
