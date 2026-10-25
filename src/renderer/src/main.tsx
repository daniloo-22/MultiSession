import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/globals.css'

// No StrictMode: its double-mounted effects would create every <webview> twice in dev.
createRoot(document.getElementById('root')!).render(<App />)
