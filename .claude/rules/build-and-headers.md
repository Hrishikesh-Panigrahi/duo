---
paths:
  - "vite.config.ts"
  - "index.html"
  - "public/**"
  - "pwa-assets.config.ts"
  - "package.json"
---

# Build, headers and the installable app

- **Where the headers live:** the CSP and security headers are in `vite.config.ts`. They're written to
  `dist/_headers` during `vite build` (Cloudflare Pages applies that file), and `npm run preview` sends them too.
  `npm run dev` sends none.
- **The CSP:** don't weaken it. No `'unsafe-inline'`, no `'unsafe-eval'`, no new origins. `connect-src` is only the
  app and its own Supabase project.
- **Third parties:** the only outside service the app contacts is Cloudflare's STUN server (`direct.ts`), which the
  CSP doesn't govern. Don't add scripts, fonts, analytics or CDNs; everything is bundled.
- **Source maps:** keep `build.sourcemap: false`.
- **The service worker:** it precaches the built files that match `globPatterns`, and there's no `runtimeCaching`.
  That's what keeps API responses and media out of the cache. Don't add runtime caching for anything a person shared.
- **Lockfile:** keep registry URLs out of `package-lock.json` (the repo's `.npmrc` sets
  `omit-lockfile-registry-resolved`).
- **Before merging a header change:** check the headers on the Cloudflare branch preview.
