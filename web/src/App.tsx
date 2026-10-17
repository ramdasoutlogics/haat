import { Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api } from './api'
import { Icon } from './icons'
import { cx } from './lib'
import { FULL_SCREEN, routes } from './routes'

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
  const [counts, setCounts] = useState({ chats: 0, notes: 0, initials: 'RD' })
  useEffect(() => {
    api.me().then((m) => setCounts({ chats: m.unread_chats, notes: m.unread_notifications, initials: m.user.initials })).catch(() => {})
  }, [pathname])
  return counts
}

function Header({ chats, notes, initials }: { chats: number; notes: number; initials: string }) {
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
          <Link to="/watchlist" className="header-icon" aria-label="Watchlist" aria-current={location.pathname === '/watchlist' ? 'page' : undefined}>
            <Icon name="heart" size={22} width={1.8} fill={location.pathname === '/watchlist' ? '#C43D19' : 'none'} stroke={location.pathname === '/watchlist' ? '#C43D19' : 'currentColor'} />
          </Link>
          <Link to="/chats" className="header-icon" aria-label={`Messages, ${chats} unread`}>
            <Icon name="chat" size={22} width={1.8} />
            {chats > 0 && <span className="count">{chats}</span>}
          </Link>
          <Link to="/account" className="header-icon" aria-label={`Notifications, ${notes} new`}>
            <Icon name="bell" size={22} width={1.8} />
            {notes > 0 && <span className="count">{notes}</span>}
          </Link>
          <Link to="/account" className="me-chip" aria-label="My account">{initials}</Link>
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
      {tab('/account', 'Account', 'user')}
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

export default function App() {
  const { pathname } = useLocation()
  const counts = useCounts()
  const full = FULL_SCREEN.some((re) => re.test(pathname))
  // Braces matter: returning scrollTo's result would hand React a non-function "cleanup" and blank the page.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return (
    <div className={cx('app', !full && 'has-tabs')}>
      <Header {...counts} />
      <main className="app-main">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {routes.map((r) => <Route key={r.path} path={r.path} element={<r.screen.Screen />} />)}
          </Routes>
        </Suspense>
      </main>
      <Footer />
      {!full && <TabBar chats={counts.chats} />}
    </div>
  )
}
