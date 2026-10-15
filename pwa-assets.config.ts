// Regenerates the PNG icons in public/ from public/logo.svg: `npm run icons`.
// The logo is full-bleed with its glyph inside the maskable safe zone, so no padding.
import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: {
    ...preset,
    transparent: { ...preset.transparent, padding: 0 },
    maskable: { ...preset.maskable, padding: 0 },
    apple: { ...preset.apple, padding: 0 },
  },
  images: ['public/logo.svg'],
})
