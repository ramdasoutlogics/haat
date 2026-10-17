import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { AuthProvider } from './auth'
import { routes } from './routes'
import { InitialProvider, matchScreen, type InitialState } from './ssr'

declare global {
  interface Window {
    __HAAT__?: InitialState
  }
}

async function start() {
  const initial = window.__HAAT__ ?? null
  // Load the first screen's code before hydrating so the markup matches the server's.
  await matchScreen(routes, window.location.pathname)?.screen.preload()
  hydrateRoot(
    document.getElementById('root')!,
    <StrictMode>
      <InitialProvider state={initial}>
        <AuthProvider user={initial?.user ?? null}>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </InitialProvider>
    </StrictMode>,
  )
}

start()
