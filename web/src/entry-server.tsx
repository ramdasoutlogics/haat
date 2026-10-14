import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import App from './App'
import { setApiBase } from './api'
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

/** Render the first page on the server, with its data already loaded. */
export async function render(url: string, apiBase: string): Promise<Rendered> {
  setApiBase(apiBase)
  const u = new URL(url, 'http://local')
  const match = matchScreen(routes, u.pathname)!
  const mod = await match.screen.preload()
  let data: unknown = null
  let error: string | null = null
  let status = 200
  if (mod.load) {
    try {
      data = await mod.load({ params: match.params, search: u.searchParams })
    } catch (e) {
      error = (e as Error).message
      status = /not found/i.test(error) ? 404 : 500
    }
  }
  if (match.screen === routes[routes.length - 1].screen) status = 404
  const state: InitialState = { url: u.pathname + u.search, data, error, now: Date.now() }
  const html = renderToString(
    <StrictMode>
      <InitialProvider state={state}>
        <StaticRouter location={url} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </StaticRouter>
      </InitialProvider>
    </StrictMode>,
  )
  const title = data && mod.title ? `${mod.title(data as never)} · Haat` : 'Haat · Buy and sell near you'
  return { html, state, title, status, screenFile: match.file }
}
