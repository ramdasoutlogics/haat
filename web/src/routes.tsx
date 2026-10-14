import { lazyScreen, type ScreenRoute } from './ssr'

const messages = lazyScreen(() => import('./screens/Messages'))

// `file` lets the server tell the browser to fetch the first screen's code right away (modulepreload).

// Every screen is its own chunk, downloaded only when first visited.
export const routes: ScreenRoute[] = [
  { path: '/', file: 'src/screens/Home.tsx', screen: lazyScreen(() => import('./screens/Home')) },
  { path: '/search', file: 'src/screens/Search.tsx', screen: lazyScreen(() => import('./screens/Search')) },
  { path: '/listing/:id', file: 'src/screens/Listing.tsx', screen: lazyScreen(() => import('./screens/Listing')) },
  { path: '/sell', file: 'src/screens/Sell.tsx', screen: lazyScreen(() => import('./screens/Sell')) },
  { path: '/chats', file: 'src/screens/Messages.tsx', screen: messages },
  { path: '/chats/:id', file: 'src/screens/Messages.tsx', screen: messages },
  { path: '/account', file: 'src/screens/Account.tsx', screen: lazyScreen(() => import('./screens/Account')) },
  { path: '*', file: 'src/screens/NotFound.tsx', screen: lazyScreen(() => import('./screens/NotFound')) },
]

/** Screens that bring their own bottom action bar on phones, so the tab bar is hidden there. */
export const FULL_SCREEN = [/^\/listing\//, /^\/sell/, /^\/chats\/\d+/]
