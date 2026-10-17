import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { trackViewport } from './lib/device'
import { captureInvite } from './lib/invite'
import './index.css'

captureInvite()
registerSW({ immediate: true })
trackViewport()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
