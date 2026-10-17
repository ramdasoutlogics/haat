/**
 * Server-rendered first page + lazy-loaded screens.
 *
 * Each screen module exports a default component and, optionally, `load()` (its data) and `title()`.
 * On the first request the server preloads the matching screen, runs its `load()`, renders HTML and
 * embeds the data. The browser preloads the same screen, hydrates with that data, and from then on
 * the app is a normal SPA: other screens download only when visited.
 */
import { createContext, lazy, useContext, useEffect, useRef, useState, type ComponentType } from 'react'
import { matchRoutes, useLocation, useParams } from 'react-router-dom'
import type { SessionUser } from './api'

export interface LoadArgs {
  params: Record<string, string | undefined>
  search: URLSearchParams
}
export type Loader<T = unknown> = (args: LoadArgs) => Promise<T>

export interface ScreenModule {
  default: ComponentType
  load?: Loader
  title?: (data: never) => string
}

export interface InitialState {
  url: string
  data: unknown
  error: string | null
  now: number
  user: SessionUser | null
}

export function lazyScreen(importer: () => Promise<ScreenModule>) {
  let mod: ScreenModule | null = null
  const preload = async () => (mod ??= await importer())
  const Lazy = lazy(preload)
  function Screen() {
    // Already loaded (server render, hydration, or a revisit): render directly so markup matches.
    if (mod) {
      const C = mod.default
      return <C />
    }
    return <Lazy />
  }
  return { Screen, preload, get mod() { return mod } }
}

/** `auth`: only for signed-in people; everyone else sees the sign-in screen. */
export type ScreenRoute = { path: string; file: string; screen: ReturnType<typeof lazyScreen>; auth?: boolean }

export function matchScreen(routes: ScreenRoute[], pathname: string) {
  const m = matchRoutes(routes, pathname)
  if (!m) return null
  const last = m[m.length - 1]
  return { screen: last.route.screen, file: last.route.file, auth: !!last.route.auth, params: last.params as Record<string, string | undefined> }
}

// ---- initial data handed from the server to the first render ----

const InitialCtx = createContext<{ state: InitialState | null; used: { current: boolean } }>({
  state: null,
  used: { current: false },
})

export function InitialProvider({ state, children }: { state: InitialState | null; children: React.ReactNode }) {
  const used = useRef(false)
  return <InitialCtx.Provider value={{ state, used }}>{children}</InitialCtx.Provider>
}

/** Server time on the first render (so text matches during hydration), live time afterwards. */
export function useNow(tickMs = 30000) {
  const { state } = useContext(InitialCtx)
  const [now, setNow] = useState(() => state?.now ?? Date.now())
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(t)
  }, [tickMs])
  return now
}

/**
 * Data for the current screen. Uses the server's data on the first render, fetches on navigation.
 */
export function usePageData<T>(load: Loader<T>) {
  const { state, used } = useContext(InitialCtx)
  const location = useLocation()
  const params = useParams()
  const key = location.pathname + location.search
  const seeded = !used.current && state?.url === key
  const [data, setData] = useState<T | null>(seeded ? (state!.data as T) : null)
  const [error, setError] = useState<string | null>(seeded ? state!.error : null)
  const [loading, setLoading] = useState(!seeded)
  const [nonce, setNonce] = useState(0)
  const skip = useRef(seeded)

  useEffect(() => {
    used.current = true
    if (skip.current) {
      skip.current = false
      return
    }
    let live = true
    setLoading(true)
    load({ params, search: new URLSearchParams(location.search) })
      .then((d) => {
        if (live) {
          setData(d)
          setError(null)
        }
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce])

  return { data, setData, error, loading, reload: () => setNonce((n) => n + 1) }
}
