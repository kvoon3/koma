import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installDebugHandle } from './debug'
import './index.css'

installDebugHandle()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
