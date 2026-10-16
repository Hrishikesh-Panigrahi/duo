---
paths:
  - "src/features/**"
  - "src/components/**"
  - "src/App.tsx"
  - "src/main.tsx"
  - "src/index.css"
---

# Screens and components

- Components are functions of at most 29 lines, like every other function. Split by job (see `contact-detail`,
  `contact-form`, `contact-import`), not into one-line wrappers.
- Read data and call actions only through `useSpace()`, for example `useSpace().actions.chat.send({ body })`.
  Never call Supabase directly from a screen.
- For a form's save-and-report, use `useBusy`. For storage on this device, use `deviceStorage`.
- Never render user content as HTML: no `dangerouslySetInnerHTML`, no `innerHTML`. Links built from content use
  fixed schemes only: `tel:`, `sms:`, `mailto:`, `https://wa.me/`, or `http(s)` matched by `URL_RE` in chat.
  Never `javascript:` or `data:`.
- Media opens through blob URLs with a type from `PLAYABLE_TYPE`. Never use `data:` URLs or object URLs typed
  from untrusted input.
- No new security UI: no extra passwords, PINs, confirmations or settings. The passphrase is the only security
  step people see.
- Copy is short, friendly and plain ("Couldn't decrypt", not error codes). Errors go through `errorMessage`.
- Style with Tailwind classes and the tokens in `src/index.css`. React `style` props are fine for computed values
  (React sets them through the DOM, which the CSP allows). `<style>` tags and inline `<script>` are blocked by the CSP.
- Adding a non-UI folder or markdown file to the repo? Add an `@source not` line in `src/index.css`.
