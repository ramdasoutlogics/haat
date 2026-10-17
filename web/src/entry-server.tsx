import { AsyncLocalStorage } from 'node:async_hooks'
import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import App from './App'
import { api, setApiBase, setRequestHeaders } from './api'
import { AuthProvider } from './auth'
import { routes } from './routes'
import { InitialProvider, matchScreen, type InitialState } from './ssr'

export interface Rendered {
  html: string
  state: InitialState
  title: string
  status: number
  /** Source file of the screen rendered, so its code can be preloaded. */
  screenFile: string
}

// Each request's cookie, kept apart from other requests rendering at the same time.
const visitorCookie = new AsyncLocalStorage<string>()
setRequestHeaders((): Record<string, string> => {
  const cookie = visitorCookie.getStore()
  return cookie ? { cookie } : {}
})

/** Render the first page on the server, with its data already loaded. */
export function render(url: string, apiBase: string, cookie = ''): Promise<Rendered> {
  return visitorCookie.run(cookie, () => renderPage(url, apiBase))
}

async function renderPage(url: string, apiBase: string): Promise<Rendered> {
  setApiBase(apiBase)
  const u = new URL(url, 'http://local')
  const match = matchScreen(routes, u.pathname)!
  const [mod, user] = await Promise.all([
    match.screen.preload(),
    api.session().then((s) => s.user, () => null),
  ])
  let data: unknown = null
  let error: string | null = null
  let status = 200
  if (mod.load && (user || !match.auth)) {
    try {
      data = await mod.load({ params: match.params, search: u.searchParams })
    } catch (e) {
      error = (e as Error).message
      status = /not found/i.test(error) ? 404 : 500
    }
  }
  if (match.screen === routes[routes.length - 1].screen) status = 404
  const state: InitialState = { url: u.pathname + u.search, data, error, now: Date.now(), user }
  const html = renderToString(
    <StrictMode>
      <InitialProvider state={state}>
        <AuthProvider user={user}>
          <StaticRouter location={url} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <App />
          </StaticRouter>
        </AuthProvider>
      </InitialProvider>
    </StrictMode>,
  )
  const title = data && mod.title ? `${mod.title(data as never)} · Haat` : 'Haat · Buy and sell near you'
  return { html, state, title, status, screenFile: match.file }
}
