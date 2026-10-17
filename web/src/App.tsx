import { Suspense, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError, signInUrl, type SessionUser } from './api'
import { SignInScreen, signOut, useAuth, UserAvatar } from './auth'
import { Toast } from './components/ui'
import { Icon } from './icons'
import { cx } from './lib'
import { FULL_SCREEN, routes } from './routes'
import { matchScreen } from './ssr'

const SECTIONS: [string, string][] = [
  ['Marketplace', '/'],
  ['Cars & Bikes', '/search?category=Cars'],
  ['Property', '/search?category=Property'],
  ['Mobiles', '/search?category=Mobiles'],
  ['Tech', '/search?category=Tech'],
  ['Free stuff', '/search?formats=free'],
  ['Auctions', '/search?formats=auction'],
]

/** Unread counts for the header and tab bar; refreshed on navigation. */
function useCounts() {
  const { pathname } = useLocation()
  const { user, setUser } = useAuth()
  const [counts, setCounts] = useState({ chats: 0, notes: 0 })
  const signedIn = !!user
  useEffect(() => {
    if (!signedIn) {
      setCounts({ chats: 0, notes: 0 })
      return
    }
    api.me()
      .then((m) => setCounts({ chats: m.unread_chats, notes: m.unread_notifications }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setUser(null) // the session ended
      })
  }, [pathname, signedIn, setUser])
  return counts
}

/** Avatar in the header; opens a small menu with the account link and sign out. */
function MeMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="me-menu" ref={ref}>
      <button type="button" className="me-chip" aria-label="My account" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <UserAvatar user={user} className="me-chip-face" />
      </button>
      {open && (
        <div className="me-pop" role="menu">
          <span className="me-pop-name">{user.name}</span>
          <Link to="/account" role="menuitem" className="me-pop-item"><Icon name="user" size={18} />My account</Link>
          <Link to="/account?tab=watch" role="menuitem" className="me-pop-item"><Icon name="heart" size={18} />Watchlist</Link>
          <button type="button" role="menuitem" className="me-pop-item" onClick={signOut}><Icon name="logout" size={18} />Sign out</button>
        </div>
      )}
    </div>
  )
}

function Header({ chats, notes }: { chats: number; notes: number }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') ?? '')
  useEffect(() => {
    if (location.pathname === '/search') setQ(new URLSearchParams(location.search).get('q') ?? '')
  }, [location])
  const here = location.pathname + location.search
  return (
    <header className="site-header d-only">
      <div className="wrap bar">
        <Link to="/" className="brand" aria-label="Haat home">
          <span className="brand-mark"><Icon name="bag" size={20} stroke="#fff" /></span>
          <span className="brand-name">haat</span>
        </Link>
        <button type="button" className="pill-btn">
          <Icon name="pin" size={18} stroke="#1E5B43" />
          Bengaluru
          <Icon name="down" size={16} stroke="#5B665F" />
        </button>
        <button type="button" className="pill-btn lang" aria-label="Change language">EN · हिंदी</button>
        <form className="header-search" role="search" onSubmit={(e) => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(q.trim())}`) }}>
          <label htmlFor="hq" className="sr">Search Haat</label>
          <Icon name="search" size={18} stroke="#5B665F" />
          <input id="hq" type="search" placeholder="Search cars, phones, houses, jobs…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit">Search</button>
        </form>
        <nav aria-label="Account" className="header-nav">
          <Link to="/account?tab=watch" className="header-icon" aria-label="Watchlist"><Icon name="heart" size={22} width={1.8} /></Link>
          <Link to="/chats" className="header-icon" aria-label={`Messages, ${chats} unread`}>
            <Icon name="chat" size={22} width={1.8} />
            {chats > 0 && <span className="count">{chats}</span>}
          </Link>
          <Link to="/account" className="header-icon" aria-label={`Notifications, ${notes} new`}>
            <Icon name="bell" size={22} width={1.8} />
            {notes > 0 && <span className="count">{notes}</span>}
          </Link>
          {user ? <MeMenu user={user} /> : <a href={signInUrl(here)} className="signin-btn">Sign in</a>}
          <Link to="/sell" className="sell-btn"><Icon name="plus" size={18} width={2.4} />Sell</Link>
        </nav>
      </div>
      <nav aria-label="Sections" className="wrap section-nav">
        {SECTIONS.map(([label, to]) => (
          <Link key={label} to={to} className={cx(here === to && 'on')}>{label}</Link>
        ))}
      </nav>
    </header>
  )
}

function Footer() {
  return (
    <footer className="site-footer d-only">
      <div className="wrap cols">
        <div className="col">
          <span className="brand-name" style={{ fontSize: 22 }}>haat</span>
          <span className="muted" style={{ lineHeight: 1.5 }}>The local marketplace for India.</span>
        </div>
        <div className="col"><strong>Buy</strong><Link to="/">Marketplace</Link><Link to="/search?category=Cars">Cars &amp; Bikes</Link><Link to="/search?category=Property">Property</Link><Link to="/search?formats=auction">Auctions</Link></div>
        <div className="col"><strong>Sell</strong><Link to="/sell">List an item</Link><Link to="/account">My listings</Link><Link to="/sell">Boost &amp; promote</Link><Link to="/account">Fees</Link></div>
        <div className="col"><strong>Help</strong><Link to="/">Help centre</Link><Link to="/">Safety tips</Link><Link to="/">Buyer protection</Link><Link to="/">Contact us</Link></div>
      </div>
      <div className="wrap legal">
        <span>© 2026 Haat</span>
        <span style={{ display: 'flex', gap: 18 }}><Link to="/">Privacy</Link><Link to="/">Terms</Link><Link to="/">Cookies</Link></span>
      </div>
    </footer>
  )
}

function TabBar({ chats }: { chats: number }) {
  const { user } = useAuth()
  const tab = (to: string, label: string, icon: 'home' | 'search' | 'chat' | 'user', end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => cx('tab', isActive && 'on')}>
      {({ isActive }) => (
        <>
          <Icon name={icon} size={24} width={isActive ? 2.1 : 1.9} fill={isActive && icon === 'home' ? '#E3EEE8' : 'none'} />
          {label}
          {icon === 'chat' && chats > 0 && <span className="count">{chats}</span>}
        </>
      )}
    </NavLink>
  )
  return (
    <nav aria-label="Main" className="tabbar">
      {tab('/', 'Home', 'home', true)}
      {tab('/search', 'Search', 'search')}
      <Link to="/sell" aria-label="Sell" className="tab-sell"><Icon name="plus" size={24} width={2.6} /></Link>
      {tab('/chats', 'Chats', 'chat')}
      {tab('/account', user ? 'Account' : 'Sign in', 'user')}
    </nav>
  )
}

function RouteFallback() {
  return (
    <div className="route-loading">
      <span className="top-progress" />
      <span className="spinner" aria-label="Loading" />
    </div>
  )
}

/** Shows why Google sign-in failed (the API sends people back with ?signin_error=...). */
function useSignInError() {
  const location = useLocation()
  const navigate = useNavigate()
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    const qs = new URLSearchParams(location.search)
    const err = qs.get('signin_error')
    if (!err) return
    setMessage(err)
    qs.delete('signin_error')
    navigate({ pathname: location.pathname, search: qs.toString() ? `?${qs}` : '' }, { replace: true })
  }, [location, navigate])
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 6000)
    return () => clearTimeout(t)
  }, [message])
  return message
}

export default function App() {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const counts = useCounts()
  const signInError = useSignInError()
  const gated = !user && !!matchScreen(routes, pathname)?.auth // sign-in screen keeps the tab bar
  const full = !gated && FULL_SCREEN.some((re) => re.test(pathname))
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return (
    <div className={cx('app', !full && 'has-tabs')}>
      <Header {...counts} />
      <main className="app-main">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {routes.map((r) => <Route key={r.path} path={r.path} element={r.auth && !user ? <SignInScreen /> : <r.screen.Screen />} />)}
          </Routes>
        </Suspense>
      </main>
      <Footer />
      {!full && <TabBar chats={counts.chats} />}
      {signInError && <Toast>{signInError}</Toast>}
    </div>
  )
}
