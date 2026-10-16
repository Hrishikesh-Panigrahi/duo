import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Browser-enforced rules for the deployed app. The content security policy
 * only lets the page run its own scripts and talk to its own Supabase project,
 * so even if something slipped past React's escaping, injected code couldn't
 * run or send your data anywhere else. The rest stop other sites framing the
 * app, sniffing file types, or seeing where you came from.
 */
function securityHeaders(supabaseUrl: string): Record<string, string> {
  const api = new URL(supabaseUrl)
  const socket = `${api.protocol === 'https:' ? 'wss' : 'ws'}://${api.host}`
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    // data: is the contact QR code; blob: is a photo being sent or viewed.
    "img-src 'self' data: blob:",
    'media-src blob:',
    "font-src 'self'",
    `connect-src 'self' ${api.origin} ${socket}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ')
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=(), browsing-topics=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  }
}

/** Writes the headers into dist/_headers, which Cloudflare Pages applies to every response. */
function cloudflareHeaders(headers: Record<string, string>): Plugin {
  return {
    name: 'duo-security-headers',
    apply: 'build',
    generateBundle() {
      const lines = ['/*', ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`)]
      this.emitFile({ type: 'asset', fileName: '_headers', source: `${lines.join('\n')}\n` })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const headers = securityHeaders(env.VITE_SUPABASE_URL || 'http://localhost')

  return {
    // Never ship source maps: no readable copy of the code next to the app.
    build: { sourcemap: false },
    // `npm run preview` serves the build with the same headers, to test them locally.
    preview: { headers },
    plugins: [
      react(),
      tailwindcss(),
      cloudflareHeaders(headers),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'logo.svg', 'apple-touch-icon-180x180.png'],
        manifest: {
          name: 'Duo',
          short_name: 'Duo',
          description: 'Shared contacts, chat, lists and notes for the two of you.',
          theme_color: '#faf6f3',
          background_color: '#faf6f3',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          navigateFallback: '/index.html',
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        },
      }),
    ],
  }
})
