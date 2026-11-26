import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Listing } from '../api'
import { Empty, ErrorBox, Thumb, Toast, VerifiedMark } from '../components/ui'
import { Icon } from '../icons'
import { ago, cx, inr, priceOf, timeLeft } from '../lib'
import { usePageData, useNow } from '../ssr'

export function load(): Promise<Listing[]> {
  return api.watchlist()
}
export function title() {
  return 'Watchlist'
}

type Filter = 'all' | 'auction' | 'buy' | 'drops' | 'closed'
type Sort = 'recent' | 'ending' | 'price_asc' | 'price_desc'

const SORTS: [Sort, string][] = [
  ['recent', 'Recently saved'],
  ['ending', 'Ending soonest'],
  ['price_asc', 'Lowest price'],
  ['price_desc', 'Highest price'],
]
const DAY = 24 * 60 * 60 * 1000
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const km = (n: number) => (n < 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n)))

/** What the item costs right now (current bid for auctions). */
const amount = (l: Listing) => (l.format === 'auction' ? l.current_bid ?? l.price : l.price)
/** Change since the item was saved: negative is cheaper. */
const change = (l: Listing) => (l.saved_price == null ? 0 : amount(l) - l.saved_price)
const isClosed = (l: Listing, now: number) =>
  l.status !== 'active' || (l.format === 'auction' && !!l.closes_at && new Date(l.closes_at).getTime() <= now)
const msLeft = (l: Listing, now: number) => (l.closes_at ? new Date(l.closes_at).getTime() - now : Infinity)
const endingSoon = (l: Listing, now: number) => l.format === 'auction' && !isClosed(l, now) && msLeft(l, now) < DAY
const dropped = (l: Listing, now: number) => l.format !== 'auction' && !isClosed(l, now) && change(l) < 0

function matches(l: Listing, f: Filter, now: number): boolean {
  switch (f) {
    case 'auction': return l.format === 'auction' && !isClosed(l, now)
    case 'buy': return l.format !== 'auction' && !isClosed(l, now)
    case 'drops': return dropped(l, now)
    case 'closed': return isClosed(l, now)
    default: return true
  }
}

function sorted(items: Listing[], sort: Sort, now: number): Listing[] {
  const out = [...items] // server order is most recently saved first
  if (sort === 'ending') {
    // Live auctions by closing time, then everything else as saved; closed items last.
    const rank = (l: Listing) => (isClosed(l, now) ? Infinity : l.format === 'auction' ? msLeft(l, now) : Number.MAX_SAFE_INTEGER)
    out.sort((a, b) => rank(a) - rank(b))
  } else if (sort === 'price_asc') out.sort((a, b) => amount(a) - amount(b))
  else if (sort === 'price_desc') out.sort((a, b) => amount(b) - amount(a))
  return out
}

export default function Watchlist() {
  const { data, setData, error, reload } = usePageData(load)
  const now = useNow(15000)
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const remove = async (l: Listing) => {
    if (!data) return
    const idx = data.findIndex((x) => x.id === l.id)
    const restore = () => setData((d) => d && (d.some((x) => x.id === l.id) ? d : [...d.slice(0, idx), l, ...d.slice(idx)]))
    setData((d) => d && d.filter((x) => x.id !== l.id))
    try {
      await api.watch(l.id, false)
      setToast({
        text: 'Removed from watchlist',
        undo: async () => {
          setToast(null)
          restore()
          try {
            await api.watch(l.id, true, { saved_price: l.saved_price, watched_at: l.watched_at })
          } catch {
            setData((d) => d && d.filter((x) => x.id !== l.id))
            setToast({ text: "Couldn't put it back. Please try again." })
          }
        },
      })
    } catch {
      restore()
      setToast({ text: "Couldn't update your watchlist" })
    }
  }

  if (error && !data) return <div className="wl wrap"><ErrorBox message={error} onRetry={reload} /></div>
  if (!data) return <WatchlistSkeleton />

  const live = data.filter((l) => !isClosed(l, now))
  const counts: Record<Filter, number> = {
    all: data.length,
    auction: data.filter((l) => matches(l, 'auction', now)).length,
    buy: data.filter((l) => matches(l, 'buy', now)).length,
    drops: data.filter((l) => dropped(l, now)).length,
    closed: data.length - live.length,
  }
  const FILTERS: [Filter, string][] = [
    ['all', 'All'],
    ['auction', 'Auctions'],
    ['buy', 'Buy & offers'],
    ['drops', 'Price drops'],
    ['closed', 'Sold & ended'],
  ]
  const shown = FILTERS.filter(([f]) => f === 'all' || f === filter || counts[f] > 0)
  const items = sorted(data.filter((l) => matches(l, filter, now)), sort, now)
  const soon = live.filter((l) => endingSoon(l, now)).length
  const winning = live.filter((l) => l.format === 'auction' && l.you_lead).length
  const outbid = live.filter((l) => l.format === 'auction' && l.my_bid && !l.you_lead).length
  const saved = data.filter((l) => dropped(l, now)).reduce((s, l) => s - change(l), 0)

  const summary = [
    soon && `${soon} ending today`,
    counts.drops && plural(counts.drops, 'price drop'),
    outbid && `${outbid} outbid`,
  ].filter(Boolean).join(' · ')

  const sortSelect = (id: string, className: string) => (
    <>
      <label htmlFor={id} className="sr">Sort watchlist</label>
      <select id={id} className={className} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
        {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </>
  )

  const chips = (
    <div role="group" aria-label="Show" className="chips wl-chips">
      {shown.map(([f, label]) => (
        <button key={f} type="button" aria-pressed={filter === f} className={cx('chip', filter === f && 'on')} onClick={() => setFilter(f)}>
          {label}<span className="wl-chip-n">{counts[f]}</span>
        </button>
      ))}
    </div>
  )

  const body = data.length === 0 ? (
    <div className="wl-empty">
      <Empty icon="heart" title="Nothing saved yet">
        <span>Tap the heart on any listing to keep it here. We'll show price drops and when auctions are about to close.</span>
        <Link to="/search" className="btn primary sm">Browse listings</Link>
      </Empty>
    </div>
  ) : items.length === 0 ? (
    <div className="wl-empty">
      <Empty icon="search" title="Nothing here right now">
        <button type="button" className="btn ghost sm" onClick={() => setFilter('all')}>Show everything</button>
      </Empty>
    </div>
  ) : (
    <ul className="wl-grid">
      {items.map((l) => <li key={l.id}><WatchCard listing={l} now={now} onRemove={() => remove(l)} /></li>)}
    </ul>
  )

  return (
    <div className="wl">
      {/* ---------- Phone ---------- */}
      <header className="m-only wl-top">
        <div className="wl-top-row">
          <div>
            <h1 className="display">Watchlist</h1>
            <span className="muted">{data.length ? summary || plural(data.length, 'saved item') : 'Save things to keep an eye on them'}</span>
          </div>
          {data.length > 1 && <span className="wl-sort-m">{sortSelect('wl-sort-m', '')}<Icon name="down" size={14} width={2.4} /></span>}
        </div>
        {data.length > 0 && chips}
      </header>

      {/* ---------- Desktop ---------- */}
      <div className="d-only wrap wl-d-head">
        <nav aria-label="Breadcrumb" className="srch-crumbs">
          <Link to="/account">My Haat</Link><span aria-hidden="true">/</span><span className="here">Watchlist</span>
        </nav>
        <div className="wl-head">
          <div className="wl-title">
            <h1 className="display">Watchlist</h1>
            <span className="muted">{plural(data.length, 'saved item')}</span>
          </div>
          {data.length > 1 && sortSelect('wl-sort', 'srch-select')}
        </div>
        {data.length > 0 && (
          <div className="wl-stats">
            <div className="wl-stat"><span>Ending today</span><strong className="display">{soon}</strong><em>{soon ? 'Auctions closing within 24h' : 'No auctions closing soon'}</em></div>
            <div className="wl-stat"><span>Price drops</span><strong className="display">{counts.drops}</strong><em>{saved ? `${inr(saved)} cheaper than when saved` : 'We compare with the price you saved at'}</em></div>
            <div className="wl-stat"><span>Winning</span><strong className="display">{winning}</strong><em className={cx(outbid > 0 && 'bad')}>{outbid ? `Outbid on ${outbid}` : 'Auctions you lead'}</em></div>
          </div>
        )}
        {data.length > 0 && chips}
      </div>

      <div className="wrap wl-body">{body}</div>

      {toast && (
        <Toast>
          <span className="acct-toast">
            {toast.text}
            {toast.undo && <button type="button" onClick={toast.undo}>Undo</button>}
          </span>
        </Toast>
      )}
    </div>
  )
}

function WatchCard({ listing: l, now, onRemove }: { listing: Listing; now: number; onRemove: () => void }) {
  const href = `/listing/${l.id}`
  const closed = isClosed(l, now)
  const diff = change(l)
  const auction = l.format === 'auction'

  let status: React.ReactNode
  if (closed) {
    status = <span className="wl-tag gray">{l.status === 'sold' ? 'Sold' : auction ? 'Auction ended' : 'No longer available'}</span>
  } else if (auction) {
    const left = msLeft(l, now)
    status = (
      <>
        <span className={cx('wl-tag', left < DAY ? 'red' : 'cream')}><Icon name="clock" size={13} width={2.4} />Closes in {timeLeft(l.closes_at, now)}</span>
        {l.you_lead ? <span className="wl-tag green"><Icon name="check" size={13} width={2.6} />You're winning</span>
          : l.my_bid ? <span className="wl-tag red">Outbid · your bid {inr(l.my_bid)}</span>
            : <span className="wl-tag">{plural(l.bids_count, 'bid')}</span>}
      </>
    )
  } else {
    status = <span className="wl-tag">{{ fixed: 'Buy Now', offer: 'Open to offers', free: 'Free to collect', auction: '' }[l.format]}</span>
  }

  const cta = closed
    ? { label: 'See similar', to: `/search?category=${encodeURIComponent(l.category)}`, kind: 'ghost' }
    : auction ? { label: l.you_lead ? 'View auction' : 'Place a bid', to: href, kind: l.you_lead ? 'ghost' : 'red' }
      : l.format === 'offer' ? { label: 'Make an offer', to: href, kind: 'dark' }
        : { label: 'View item', to: href, kind: 'dark' }

  return (
    <article className={cx('wcard card-hover', closed && 'closed')}>
      <Link to={href} className="wcard-img" tabIndex={-1} aria-hidden="true">
        <Thumb listing={l} size={44}>{closed && <span className="wcard-flag">{l.status === 'sold' ? 'SOLD' : 'ENDED'}</span>}</Thumb>
      </Link>
      <div className="wcard-body">
        <span className="wcard-price">
          <strong className="display">{priceOf(l)}</strong>
          {!closed && diff < 0 && <span className="wl-drop"><Icon name="trend" size={13} width={2.4} style={{ transform: 'scaleY(-1)' }} />{inr(-diff)} less</span>}
          {!closed && diff > 0 && <span className="wl-up">+{inr(diff)} since saved</span>}
        </span>
        <Link to={href} className="wcard-title">{l.title}</Link>
        <span className="wcard-status">{status}</span>
        <span className="wcard-meta">
          {l.location} · {km(l.distance_km)} km · {l.seller_name}{l.seller_verified && <VerifiedMark size={13} />}
        </span>
        <span className="wcard-foot">
          <span className="wcard-saved">Saved {ago(l.watched_at ?? null, now, true).toLowerCase()}{l.watchers && l.watchers > 1 ? ` · ${l.watchers} watching` : ''}</span>
          <Link to={cta.to} className={cx('d-only btn sm wcard-cta', cta.kind)}>{cta.label}</Link>
        </span>
      </div>
      <button type="button" className="wcard-remove" aria-label={`Remove ${l.title} from watchlist`} onClick={onRemove}>
        <Icon name="heart" size={18} fill="#C43D19" stroke="#C43D19" />
      </button>
    </article>
  )
}

function WatchlistSkeleton() {
  return (
    <div className="wl" aria-busy="true" aria-label="Loading your watchlist">
      <div className="m-only wl-top"><span className="skeleton wl-sk-title" /></div>
      <div className="d-only wrap wl-d-head"><span className="skeleton wl-sk-title" /></div>
      <div className="wrap wl-body"><div className="wl-grid">{[0, 1, 2].map((i) => <span key={i} className="skeleton wl-sk-card" />)}</div></div>
    </div>
  )
}
