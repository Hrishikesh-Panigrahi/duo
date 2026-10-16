---
paths:
  - "vite.config.ts"
  - "index.html"
  - "public/**"
  - "pwa-assets.config.ts"
  - "package.json"
---

# Build, headers and the installable app

- The CSP and security headers live in `vite.config.ts`. They're written to `dist/_headers` for Cloudflare Pages,
  and `npm run preview` serves them too.
- Don't weaken the CSP: no `'unsafe-inline'`, no `'unsafe-eval'`, no new origins. `connect-src` is only the app and
  its own Supabase project.
- Keep `build.sourcemap: false`.
- No third-party scripts, fonts, analytics or CDNs. Everything is bundled.
- The service worker precaches the app shell only (`globPatterns`). Never cache API responses, media or anything
  a person shared.
- Dependencies: install through the configured registry. On a 401 or 403, stop and ask. Keep
  `package-lock.json` free of registry URLs (the repo's `.npmrc` sees to that).
- After changing headers, check them on the branch preview (`<branch>.our-duo.pages.dev`) before merging.
