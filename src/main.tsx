import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import App from '@/App'
import { initInstallPrompt } from '@/lib/install'
import { initAppUpdates } from '@/lib/updates'

initInstallPrompt()
initAppUpdates()

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)