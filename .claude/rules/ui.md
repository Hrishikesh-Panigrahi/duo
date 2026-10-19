---
paths:
  - "src/features/**"
  - "src/components/**"
  - "src/App.tsx"
  - "src/main.tsx"
  - "src/index.css"
---

# Screens and components

**Structure**
- Components are functions of at most 29 lines, like every other function. Split by job (see `contact-detail`,
  `contact-form`, `contact-import`), not into one-line wrappers.
- Inside `SpaceProvider`, screens read data and call actions through `useSpace()`, for example
  `useSpace().actions.chat.send({ body })`. The exceptions: sign-out goes through `signOut()` in
  `src/lib/session.ts`, and sign-in (`auth.tsx`), space setup (`space-setup.tsx`) and the list of your spaces (`src/lib/spaces.ts`) call
  Supabase directly because they work outside the open space.
- Use `useBusy` for a form's save-and-report, and `deviceStorage` for small values kept in this browser
  (localStorage). Keys and received files live in IndexedDB (`keystore.ts`, `inbox.ts`).

**Safety**
- Never render content as HTML: no `dangerouslySetInnerHTML`, no `innerHTML`.
- Links built from content use fixed forms only:
  - `tel:`, `sms:`, `mailto:`;
  - `https://wa.me/`;
  - the Google Maps search link for addresses;
  - the `blob:` URL `downloadVCard` makes for a contact's .vcf;
  - `http(s)` URLs matched by `URL_RE` in chat.

  Never `javascript:` or `data:`.
- Media opens through blob URLs. The type comes from the sender only if it matches `PLAYABLE_TYPE`, otherwise
  `application/octet-stream`. Files are shown only in `<img>` or `<video>`.
- No new security UI. Today people see sign-in, the passphrase and "Lock this device". Don't add passwords, PINs,
  confirmations or settings.

**Copy and styling**
- Copy is short, friendly and plain ("Couldn't decrypt this message", not error codes). Errors are shown with
  `errorMessage`.
- Style with Tailwind classes and the tokens in `src/index.css`. React `style` props are fine for computed values,
  because React sets them through the DOM, which the CSP allows. `<style>` tags and inline `<script>` are blocked
  by the production CSP.
- Adding a non-UI folder or markdown file to the repo? Add an `@source not` line in `src/index.css`.
