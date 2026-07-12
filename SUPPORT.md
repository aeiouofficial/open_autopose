# Support Diagnostics

Before requesting support, collect:

- Open AutoPose version
- Operating system and Node.js version
- Chrome/Edge version
- GPU and driver version
- Output from `npm run vendor:verify`
- The failing command and complete terminal error
- Whether the machine was offline

Recommended first checks:

```bash
npm ci
npm run vendor:prepare
npm run vendor:verify
npm test
npm run probe
```

Do not send private source videos unless explicitly required and authorized. A public seller must add its monitored support channel and response policy to the storefront and release package.
