import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, type Format, type Listing, type Page, type SearchParams } from '../api'
import { Badge, Chip, Empty, ErrorBox, ListingCard, ListingRow, Loading, Sheet, Thumb, Toast, WatchButton } from '../components/ui'
import { Icon } from '../icons'
import { CATEGORIES, ago, cx, inr, priceOf, timeLeft } from '../lib'
import { usePageData, useNow, type LoadArgs } from '../ssr'

const PAGE = 12

type Query = SearchParams

const FORMATS: [Format, string][] = [
  ['fixed', 'Buy Now'],
  ['auction', 'Auction'],
  ['offer', 'Make an offer'],
  ['free', 'Free'],
]
const SORTS: [string, string][] = [
  ['best', 'Best match'],
  ['newest', 'Newest listed'],
  ['nearest', 'Closest first'],
  ['price_asc', 'Lowest price'],
  ['price_desc', 'Highest price'],
]
const ALL_FORMATS = new Set(FORMATS.map(([f]) => f))
const num = (v: string | null) => {
  const n = Number(v)
  return v && Number.isFinite(n) && n > 0 ? n : undefined
}

/** URL → API query. The URL is the source of truth so results are shareable and server-rendered. */
function parse(search: URLSearchParams): Query {
  const formats = (search.get('formats') ?? '').split(',').filter((f): f is Format => ALL_FORMATS.has(f as Format))
  const sort = search.get('sort') ?? 'best'
  return {
    q: search.get('q')?.trim() || undefined,
    category: CATEGORIES.includes(search.get('category') ?? '') ? search.get('category')! : undefined,
    formats: formats.length ? formats : undefined,
    verified: search.get('verified') === 'true' || undefined,
    max_km: num(search.get('max_km')),
    min_price: num(search.get('min_price')),
    max_price: num(search.get('max_price')),
    sort: SORTS.some(([s]) => s === sort) ? sort : 'best',
  }
}

/** API query → URL search string (defaults left out). */
function toSearch(p: Query): string {
  const qs = new URLSearchParams()
  if (p.q) qs.set('q', p.q)
  if (p.category) qs.set('category', p.category)
  if (p.formats?.length) qs.set('formats', p.formats.join(','))
  if (p.verified) qs.set('verified', 'true')
  if (p.max_km) qs.set('max_km', String(p.max_km))
  if (p.min_price) qs.set('min_price', String(p.min_price))
  if (p.max_price) qs.set('max_price', String(p.max_price))
  if (p.sort && p.sort !== 'best') qs.set('sort', p.sort)
  const s = qs.toString().replace(/%2C/g, ',')
  return s ? `?${s}` : ''
}

interface SearchData {
  page: Page<Listing>
}

export async function load({ search }: LoadArgs): Promise<SearchData> {
  return { page: await api.listings({ ...parse(search), limit: PAGE }) }
}

export function title(_data: SearchData) {
  return 'Search results'
}

const km = (n: number) => (n < 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n)))

function heading(p: Query): string {
  if (p.q) return `“${p.q}” in Bengaluru`
  if (p.category) return `${p.category} in Bengaluru`
  if (p.formats?.length === 1) return { fixed: 'Buy Now deals', auction: 'Auctions', offer: 'Open to offers', free: 'Free stuff' }[p.formats[0]] + ' in Bengaluru'
  return 'Everything in Bengaluru'
}

function filterCount(p: Query) {
  return (p.category ? 1 : 0) + (p.formats?.length ? 1 : 0) + (p.verified ? 1 : 0) + (p.max_km ? 1 : 0) + (p.min_price || p.max_price ? 1 : 0)
}

function priceRange(p: Query) {
  if (p.min_price && p.max_price) return `${inr(p.min_price)}–${inr(p.max_price)}`
  if (p.min_price) return `From ${inr(p.min_price)}`
  if (p.max_price) return `Up to ${inr(p.max_price)}`
  return ''
}

// ---------- saved searches (per-viewer, browser storage) ----------
const SAVED_KEY = 'haat.savedSearches'
function readSaved(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]')
  } catch {
    return []
  }
}
function writeSaved(list: string[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable: the toggle still works for this visit */
  }
}

export default function Search() {
  const { data, setData, error, loading, reload } = usePageData(load)
  const location = useLocation()
  const navigate = useNavigate()
  const query = parse(new URLSearchParams(location.search))
  const key = toSearch({ ...query, sort: 'best' })
  const [text, setText] = useState(query.q ?? '')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [sheet, setSheet] = useState<null | 'filters' | 'price'>(null)
  const [saved, setSaved] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [more, setMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => setText(query.q ?? ''), [query.q])
  useEffect(() => setSaved(readSaved().includes(key)), [key])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const flash = (msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }

  const apply = (patch: Partial<Query>) => navigate({ pathname: '/search', search: toSearch({ ...query, ...patch }) }, { replace: true })

  const toggleFormat = (f: Format) => {
    const cur = new Set(query.formats ?? [])
    if (cur.has(f)) cur.delete(f)
    else cur.add(f)
    apply({ formats: FORMATS.map(([k]) => k).filter((k) => cur.has(k)) })
  }

  const toggleSaved = () => {
    const list = readSaved().filter((k) => k !== key)
    const next = !saved
    writeSaved(next ? [...list, key] : list)
    setSaved(next)
    flash(next ? "Search saved. We'll alert you about new matches." : 'Saved search removed')
  }

  const loadMore = async () => {
    if (!data) return
    setMore({ busy: true, error: null })
    try {
      const next = await api.listings({ ...query, limit: PAGE, offset: data.page.items.length })
      setData({ page: { total: next.total, items: [...data.page.items, ...next.items.filter((n) => !data.page.items.some((o) => o.id === n.id))] } })
      setMore({ busy: false, error: null })
    } catch (e) {
      setMore({ busy: false, error: (e as Error).message })
    }
  }

  const items = data?.page.items ?? []
  const total = data?.page.total ?? 0
  const count = filterCount(query)
  const hasMore = items.length < total
  const clearAll = () => navigate({ pathname: '/search', search: toSearch({ q: query.q, sort: query.sort }) }, { replace: true })

  const results = !data && !error ? (
    <Loading rows={4} />
  ) : error && !data ? (
    <ErrorBox message={error} onRetry={reload} />
  ) : items.length === 0 ? (
    <Empty icon="search" title="No matches yet">
      <span>Try a different word, a wider distance or fewer filters.</span>
      {(count > 0 || query.q) && <button type="button" className="btn ghost sm" onClick={() => navigate('/search', { replace: true })}>Clear search</button>}
    </Empty>
  ) : null

  const pager = hasMore && (
    <div className="srch-more">
      <span className="muted">Showing {items.length} of {total}</span>
      <button type="button" className="btn ghost round" onClick={loadMore} disabled={more.busy}>{more.busy ? 'Loading…' : 'Load more'}</button>
      {more.error && <span role="alert" className="status-err">{more.error}</span>}
    </div>
  )

  return (
    <div className="srch">
      {/* ---------- Phone ---------- */}
      <div className="m-only srch-top">
        <div className="srch-bar">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
            <Icon name="back" size={22} width={2.2} />
          </button>
          <form className="srch-input" role="search" onSubmit={(e) => { e.preventDefault(); apply({ q: text.trim() || undefined }); (document.activeElement as HTMLElement | null)?.blur() }}>
            <Icon name="search" size={18} stroke="#5B665F" />
            <label htmlFor="srch-q" className="sr">Search</label>
            <input id="srch-q" type="search" enterKeyHint="search" placeholder="Search cars, phones, flats…" value={text} onChange={(e) => setText(e.target.value)} />
          </form>
          <button type="button" className="srch-filter-btn" aria-label={`All filters${count ? `, ${count} applied` : ''}`} onClick={() => setSheet('filters')}>
            <Icon name="filter" size={20} width={2.2} />
            {count > 0 && <span className="srch-filter-n">{count}</span>}
          </button>
        </div>
        <div className="chips srch-chips">
          <Chip on={query.max_km === 25} onClick={() => apply({ max_km: query.max_km === 25 ? undefined : 25 })}>Within 25 km</Chip>
          <Chip on={!!query.verified} onClick={() => apply({ verified: !query.verified || undefined })}>Verified sellers</Chip>
          {FORMATS.map(([f, label]) => (
            <Chip key={f} on={!!query.formats?.includes(f)} onClick={() => toggleFormat(f)}>{f === 'offer' ? 'Offers' : label}</Chip>
          ))}
          <Chip on={!!(query.min_price || query.max_price)} onClick={() => setSheet('price')}>
            <span className="srch-chip-in">{priceRange(query) || 'Price'}<Icon name="down" size={14} width={2.4} /></span>
          </Chip>
        </div>
      </div>

      <div className="m-only srch-sum">
        <span className="muted" aria-live="polite"><strong>{total.toLocaleString('en-IN')}</strong> {total === 1 ? 'result' : 'results'} near Koramangala</span>
        <label className="srch-sort-m">
          <span className="sr">Sort by</span>
          <select value={query.sort} onChange={(e) => apply({ sort: e.target.value })}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <Icon name="down" size={14} width={2.4} />
        </label>
      </div>

      <div className={cx('m-only srch-list', loading && data && 'srch-busy')} aria-busy={loading}>
        {results ?? (
          <ul>
            {items.map((l) => <li key={l.id}><ResultRow listing={l} /></li>)}
          </ul>
        )}
        {pager}
      </div>

      <div className="m-only srch-float">
        <button type="button" className={cx('srch-pill dark', saved && 'on')} aria-pressed={saved} onClick={toggleSaved}>
          <Icon name="bell" size={16} width={2.2} />{saved ? "Saved — we'll alert you" : 'Save search'}
        </button>
        <button type="button" className="srch-pill" onClick={() => flash('Map view is coming soon')}>
          <Icon name="map" size={16} width={2.2} />Map
        </button>
      </div>

      {/* ---------- Desktop ---------- */}
      <div className="d-only wrap srch-d">
        <nav aria-label="Breadcrumb" className="srch-crumbs">
          <Link to="/">Marketplace</Link>
          {query.category && <><span aria-hidden="true">/</span><Link to={`/search?category=${query.category}`}>{query.category}</Link></>}
          {query.q && <><span aria-hidden="true">/</span><span className="here">{query.q}</span></>}
          {!query.q && !query.category && <><span aria-hidden="true">/</span><span className="here">Search</span></>}
        </nav>
        <div className="srch-head">
          <div className="srch-title">
            <h1 className="display">{heading(query)}</h1>
            <span className="muted" aria-live="polite">{total.toLocaleString('en-IN')} {total === 1 ? 'listing' : 'listings'} {query.max_km ? `within ${query.max_km} km` : 'near you'}</span>
          </div>
          <div className="srch-tools">
            <button type="button" className={cx('srch-save', saved && 'on')} aria-pressed={saved} onClick={toggleSaved}>
              <Icon name="bell" size={18} />{saved ? 'Search saved' : 'Save search'}
            </button>
            <label htmlFor="srch-sort" className="sr">Sort by</label>
            <select id="srch-sort" className="srch-select" value={query.sort} onChange={(e) => apply({ sort: e.target.value })}>
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div role="group" aria-label="View" className="srch-views">
              <button type="button" aria-label="List view" aria-pressed={view === 'list'} className={cx(view === 'list' && 'on')} onClick={() => setView('list')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
              </button>
              <button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} className={cx(view === 'grid' && 'on')} onClick={() => setView('grid')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z" /></svg>
              </button>
              <button type="button" aria-label="Map view" onClick={() => flash('Map view is coming soon')}><Icon name="map" size={18} /></button>
            </div>
          </div>
        </div>

        <div className="srch-body">
          <aside aria-label="Filters" className="srch-side">
            <div className="srch-side-head">
              <strong>Filters</strong>
              <button type="button" className="srch-link" onClick={clearAll} disabled={count === 0}>Clear all</button>
            </div>
            <Filters query={query} onChange={apply} idPrefix="d" />
          </aside>

          <section aria-label="Results" className={cx('srch-results', loading && data && 'srch-busy')} aria-busy={loading}>
            <ActiveChips query={query} onChange={apply} />
            <div className="srch-note">
              <Icon name="zap" size={22} stroke="#7A6420" />
              <span>Featured listings are boosted by sellers and marked with a yellow tag.</span>
            </div>
            {results ?? (view === 'list' ? (
              <div className="srch-dlist">
                {items.map((l) => <ResultCard key={l.id} listing={l} />)}
              </div>
            ) : (
              <div className="srch-grid">
                {items.map((l) => <ListingCard key={l.id} listing={l} />)}
              </div>
            ))}
            {pager}
          </section>
        </div>
      </div>

      {sheet === 'filters' && (
        <Sheet title="Filters" onClose={() => setSheet(null)}>
          <FilterSheet query={query} onApply={(p) => { apply(p); setSheet(null) }} onClear={() => { clearAll(); setSheet(null) }} />
        </Sheet>
      )}
      {sheet === 'price' && (
        <Sheet title="Price" onClose={() => setSheet(null)}>
          <PriceSheet query={query} onApply={(p) => { apply(p); setSheet(null) }} />
        </Sheet>
      )}
      {toast && <Toast>{toast}</Toast>}
    </div>
  )
}

/** Phone result row: the shared row, with distance/bids in the meta line. */
function ResultRow({ listing: l }: { listing: Listing }) {
  const now = useNow()
  const meta = l.format === 'auction'
    ? `${l.location} · ${km(l.distance_km)} km · ${l.bids_count} bids`
    : `${l.location} · ${km(l.distance_km)} km · ${ago(l.created_at, now)}`
  return <ListingRow listing={l} meta={meta} />
}

/** Desktop list card (Web-Search). */
function ResultCard({ listing: l }: { listing: Listing }) {
  const now = useNow()
  const href = `/listing/${l.id}`
  const fmt: { kind: 'buy' | 'auc' | 'neg'; label: string; price: string } = {
    auction: { kind: 'auc' as const, label: `CLOSES ${timeLeft(l.closes_at, now).toUpperCase()}`, price: l.current_bid ? `Current bid · ${l.bids_count} bids` : 'Starting bid · no bids yet' },
    fixed: { kind: 'buy' as const, label: 'BUY NOW', price: 'Buy Now' },
    offer: { kind: 'neg' as const, label: 'MAKE AN OFFER', price: 'Asking' },
    free: { kind: 'buy' as const, label: 'FREE', price: 'Free to collect' },
  }[l.format]
  return (
    <article className="srch-card card-hover">
      <Link to={href} className="srch-card-img" tabIndex={-1} aria-hidden="true">
        <Thumb listing={l} size={56}>{l.featured && <Badge kind="feat">FEATURED</Badge>}</Thumb>
      </Link>
      <div className="srch-card-body">
        <Link to={href} className="srch-card-title">{l.title}</Link>
        <div className="srch-tags">
          <span>{l.condition}</span>
          <span>{km(l.distance_km)} km away</span>
          {l.mine && <span className="mine">Your listing</span>}
        </div>
        <span className="srch-card-meta">{l.location} · {ago(l.created_at, now, true)}</span>
        <div className="srch-card-foot">
          <div className="srch-card-price">
            <span>{fmt.price}</span>
            <strong className="display">{priceOf(l)}</strong>
          </div>
          <Badge kind={fmt.kind} big>{fmt.label}</Badge>
        </div>
      </div>
      <WatchButton listing={l} className="srch-watch" size={20} />
    </article>
  )
}

function ActiveChips({ query, onChange }: { query: Query; onChange: (p: Partial<Query>) => void }) {
  const chips: [string, Partial<Query>][] = []
  if (query.q) chips.push([`“${query.q}”`, { q: undefined }])
  if (query.category) chips.push([query.category, { category: undefined }])
  for (const f of query.formats ?? []) chips.push([FORMATS.find(([k]) => k === f)![1], { formats: query.formats!.filter((x) => x !== f) }])
  if (query.max_km) chips.push([`Within ${query.max_km} km`, { max_km: undefined }])
  if (query.min_price || query.max_price) chips.push([priceRange(query), { min_price: undefined, max_price: undefined }])
  if (query.verified) chips.push(['Verified sellers', { verified: undefined }])
  if (!chips.length) return null
  return (
    <ul className="srch-active" aria-label="Active filters">
      {chips.map(([label, patch]) => (
        <li key={label}>
          {label}
          <button type="button" aria-label={`Remove filter: ${label}`} onClick={() => onChange(patch)}>
            <Icon name="close" size={14} width={2.6} />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Filter controls shared by the desktop sidebar (applies live) and the phone sheet (applies on confirm). */
function Filters({ query, onChange, idPrefix }: { query: Query; onChange: (p: Partial<Query>) => void; idPrefix: string }) {
  const [radius, setRadius] = useState(query.max_km ?? 200)
  const [min, setMin] = useState(query.min_price ? String(query.min_price) : '')
  const [max, setMax] = useState(query.max_price ? String(query.max_price) : '')
  useEffect(() => setRadius(query.max_km ?? 200), [query.max_km])
  useEffect(() => {
    setMin(query.min_price ? String(query.min_price) : '')
    setMax(query.max_price ? String(query.max_price) : '')
  }, [query.min_price, query.max_price])

  const commitRadius = (v: number) => onChange({ max_km: v >= 200 ? undefined : v })
  const commitPrice = () => {
    const a = num(min.replace(/\D/g, ''))
    const b = num(max.replace(/\D/g, ''))
    if (a !== query.min_price || b !== query.max_price) onChange({ min_price: a, max_price: b })
  }
  const id = (s: string) => `${idPrefix}-${s}`

  return (
    <div className="srch-filters">
      <fieldset>
        <legend>Location</legend>
        <label htmlFor={id('region')} className="sr">Region</label>
        <select id={id('region')} className="srch-select full" defaultValue="Bengaluru">
          <option>Bengaluru</option>
        </select>
        <label htmlFor={id('radius')} className="srch-range-label">Distance <strong>{radius >= 200 ? 'Any' : `${radius} km`}</strong></label>
        <input id={id('radius')} type="range" min={5} max={200} step={5} value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          onPointerUp={(e) => commitRadius(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => commitRadius(Number((e.target as HTMLInputElement).value))} />
      </fieldset>

      <fieldset>
        <legend>Price (₹)</legend>
        <form className="srch-price" onSubmit={(e) => { e.preventDefault(); commitPrice() }}>
          <label htmlFor={id('pmin')} className="sr">Minimum price</label>
          <input id={id('pmin')} inputMode="numeric" placeholder="Min" value={min} onChange={(e) => setMin(e.target.value)} onBlur={commitPrice} />
          <span aria-hidden="true" className="muted">–</span>
          <label htmlFor={id('pmax')} className="sr">Maximum price</label>
          <input id={id('pmax')} inputMode="numeric" placeholder="Max" value={max} onChange={(e) => setMax(e.target.value)} onBlur={commitPrice} />
          <button type="submit" className="sr">Apply price</button>
        </form>
      </fieldset>

      <fieldset>
        <legend>How it's sold</legend>
        {FORMATS.map(([f, label]) => (
          <label key={f} className="srch-check">
            <input type="checkbox" checked={!!query.formats?.includes(f)} onChange={() => {
              const cur = new Set(query.formats ?? [])
              if (cur.has(f)) cur.delete(f)
              else cur.add(f)
              onChange({ formats: FORMATS.map(([k]) => k).filter((k) => cur.has(k)) })
            }} />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Category</legend>
        <div className="srch-pills">
          {['All', ...CATEGORIES].map((c) => {
            const on = (query.category ?? 'All') === c
            return (
              <button key={c} type="button" aria-pressed={on} className={cx('srch-opt', on && 'on')} onClick={() => onChange({ category: c === 'All' ? undefined : c })}>{c}</button>
            )
          })}
        </div>
      </fieldset>

      <div className="srch-seller">
        <strong>Seller</strong>
        <div className="srch-switch-row">
          <span id={id('ver')}>Verified sellers only</span>
          <button type="button" role="switch" aria-checked={!!query.verified} aria-labelledby={id('ver')} className={cx('srch-switch', query.verified && 'on')} onClick={() => onChange({ verified: !query.verified || undefined })}>
            <span />
          </button>
        </div>
      </div>
    </div>
  )
}

function FilterSheet({ query, onApply, onClear }: { query: Query; onApply: (p: Query) => void; onClear: () => void }) {
  const [draft, setDraft] = useState<Query>(query)
  return (
    <>
      <div className="srch-sheet-body">
        <Filters query={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} idPrefix="m" />
      </div>
      <div className="srch-sheet-actions">
        <button type="button" className="btn ghost" onClick={onClear}>Clear all</button>
        <button type="button" className="btn dark" onClick={() => onApply(draft)}>Show results</button>
      </div>
    </>
  )
}

const PRICE_PRESETS: [string, number | undefined, number | undefined][] = [
  ['Under ₹5,000', undefined, 5000],
  ['₹5,000–₹25,000', 5000, 25000],
  ['₹25,000–₹1 lakh', 25000, 100000],
  ['Over ₹1 lakh', 100000, undefined],
]

function PriceSheet({ query, onApply }: { query: Query; onApply: (p: Partial<Query>) => void }) {
  const [min, setMin] = useState(query.min_price ? String(query.min_price) : '')
  const [max, setMax] = useState(query.max_price ? String(query.max_price) : '')
  return (
    <form className="srch-price-sheet" onSubmit={(e) => { e.preventDefault(); onApply({ min_price: num(min.replace(/\D/g, '')), max_price: num(max.replace(/\D/g, '')) }) }}>
      <div className="srch-pills">
        {PRICE_PRESETS.map(([label, a, b]) => {
          const on = query.min_price === a && query.max_price === b
          return <button key={label} type="button" aria-pressed={on} className={cx('srch-opt', on && 'on')} onClick={() => onApply({ min_price: a, max_price: b })}>{label}</button>
        })}
      </div>
      <div className="srch-price">
        <label htmlFor="ps-min" className="sr">Minimum price</label>
        <input id="ps-min" inputMode="numeric" placeholder="Min ₹" value={min} onChange={(e) => setMin(e.target.value)} />
        <span aria-hidden="true" className="muted">–</span>
        <label htmlFor="ps-max" className="sr">Maximum price</label>
        <input id="ps-max" inputMode="numeric" placeholder="Max ₹" value={max} onChange={(e) => setMax(e.target.value)} />
      </div>
      <div className="srch-sheet-actions">
        <button type="button" className="btn ghost" onClick={() => onApply({ min_price: undefined, max_price: undefined })}>Any price</button>
        <button type="submit" className="btn dark">Apply</button>
      </div>
    </form>
  )
}
