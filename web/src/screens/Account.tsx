import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, type Listing, type Me, type Notification } from '../api'
import { Empty, ErrorBox, Sheet, Thumb, Toast, VerifiedMark } from '../components/ui'
import { Icon, type IconName } from '../icons'
import { ago, cx, inr, priceOf, timeLeft } from '../lib'
import { usePageData, useNow } from '../ssr'

export function load(): Promise<Me> {
  return api.me()
}
export function title() {
  return 'My account'
}

type Tab = 'ads' | 'watch' | 'bought' | 'notes'
const TABS: [Tab, string][] = [['ads', 'My ads'], ['watch', 'Watchlist'], ['bought', 'Bought']]
const tabFrom = (search: string): Tab => {
  const t = new URLSearchParams(search).get('tab')
  return t === 'watch' || t === 'bought' || t === 'notes' ? t : 'ads'
}
const DRAFT_KEY = 'haat.sell.draft'
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

function status(l: Listing): string {
  if (l.purchase_status) return l.purchase_status
  switch (l.format) {
    case 'auction': return plural(l.bids_count, 'bid')
    case 'offer': return 'Offers'
    case 'free': return 'Free'
    default: return 'Buy Now'
  }
}

/** Longer status line for the desktop table. */
function longStatus(l: Listing, now: number): string {
  if (l.format === 'auction') {
    const left = timeLeft(l.closes_at, now)
    return `Auction · ${plural(l.bids_count, 'bid')}${left && left !== 'Closed' ? ` · closes in ${left}` : ' · closed'}`
  }
  if (l.format === 'offer') return 'Make an offer'
  if (l.format === 'free') return 'Free'
  return 'Buy Now'
}

function watchMeta(l: Listing, now: number) {
  if (l.format === 'auction') {
    const left = timeLeft(l.closes_at, now)
    return `${l.location} · ${left === 'Closed' ? 'auction closed' : `closes in ${left}`}`
  }
  return `${l.location} · ${l.distance_km < 10 ? l.distance_km.toFixed(1) : Math.round(l.distance_km)} km · listed ${ago(l.created_at, now, true)}`
}

interface DraftInfo { title: string; price: string; format: string }

export default function Account() {
  const { data, setData, error, loading, reload } = usePageData(load)
  const location = useLocation()
  const now = useNow()
  const [tab, setTab] = useState<Tab>(() => tabFrom(location.search))
  const [notes, setNotes] = useState<Notification[] | null>(null)
  const [notesErr, setNotesErr] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [draft, setDraft] = useState<DraftInfo | null>(null)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)

  // Follow ?tab= when the URL changes (e.g. the header's watchlist link).
  useEffect(() => setTab(tabFrom(location.search)), [location.search])

  // Notifications: fetched after mount (the API marks them read when listed).
  useEffect(() => {
    api.notifications().then(setNotes).catch(() => setNotesErr(true))
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const d = JSON.parse(raw)
        if (d && typeof d.title === 'string') setDraft({ title: d.title, price: d.price ?? '', format: d.format ?? 'fixed' })
      }
    } catch { /* no storage */ }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const pick = (t: Tab) => {
    setTab(t)
    // Keep the URL shareable without refetching the page data.
    const url = new URL(window.location.href)
    if (t === 'ads') url.searchParams.delete('tab')
    else url.searchParams.set('tab', t)
    window.history.replaceState(window.history.state, '', url.pathname + url.search)
  }

  const soon = (what: string) => () => setToast({ text: `${what} coming soon` })

  const unwatch = async (l: Listing) => {
    if (!data) return
    const idx = data.watching.findIndex((x) => x.id === l.id)
    const restore = () => setData((d) => d && (d.watching.some((x) => x.id === l.id) ? d : { ...d, watching: [...d.watching.slice(0, idx), { ...l, watched: true }, ...d.watching.slice(idx)] }))
    setData((d) => d && { ...d, watching: d.watching.filter((x) => x.id !== l.id) })
    try {
      const r = await api.toggleWatch(l.id)
      if (r.watched) {
        // It was already removed elsewhere, so the toggle re-added it: toggle once more.
        await api.toggleWatch(l.id)
      }
      setToast({
        text: 'Removed from watchlist',
        undo: async () => {
          setToast(null)
          restore()
          try { await api.toggleWatch(l.id) } catch { setData((d) => d && { ...d, watching: d.watching.filter((x) => x.id !== l.id) }) }
        },
      })
    } catch {
      restore()
      setToast({ text: "Couldn't update your watchlist" })
    }
  }

  const share = async (l: Listing) => {
    const url = `${window.location.origin}/listing/${l.id}`
    try {
      if (navigator.share) await navigator.share({ title: l.title, url })
      else {
        await navigator.clipboard.writeText(url)
        setToast({ text: 'Link copied' })
      }
    } catch { /* cancelled */ }
  }

  if (error && !data) {
    return <div className="acct wrap"><ErrorBox message={error} onRetry={reload} /></div>
  }
  if (!data) return <AccountSkeleton />

  const { user } = data
  const newNotes = notes ? notes.filter((n) => !n.read).length : data.unread_notifications
  const views = data.listings.reduce((s, l) => s + l.views, 0)
  const watchers = data.listings.reduce((s, l) => s + (l.watchers ?? 0), 0)
  const chats = data.listings.reduce((s, l) => s + (l.chats ?? 0), 0)
  const featured = data.listings.filter((l) => l.featured).length
  const phoneTab: Tab = tab === 'notes' ? 'ads' : tab
  const rows = tab === 'watch' ? data.watching : tab === 'bought' ? data.bought : data.listings
  const draftPrice = draft && draft.format !== 'free' && Number(draft.price) ? inr(Number(draft.price)) : draft?.format === 'free' ? 'Free' : 'No price yet'

  const meta = (l: Listing) =>
    phoneTab === 'ads' ? `${plural(l.views, 'view')} · ${l.watchers ?? 0} watching · ${plural(l.chats ?? 0, 'chat')}`
      : phoneTab === 'watch' ? watchMeta(l, now)
        : `From ${l.seller_name ?? 'seller'} · ${ago(l.created_at, now, true)}`

  const empty = (where: 'm' | 'd') => (
    phoneTab === 'ads' ? (
      <Empty icon="tag" title="No ads yet">
        <span>Post your first ad in two minutes. Listing is free.</span>
        <Link to="/sell" className="btn primary sm">Post an ad</Link>
      </Empty>
    ) : phoneTab === 'watch' ? (
      <Empty icon="heart" title="Nothing in your watchlist">
        <span>Tap the heart on any listing to keep an eye on its price.</span>
        <Link to="/search" className="btn primary sm">Browse listings</Link>
      </Empty>
    ) : (
      <Empty icon="bag" title={where === 'd' ? 'Nothing bought or won yet' : 'Nothing bought yet'}>
        <span>Things you buy or win at auction show up here.</span>
      </Empty>
    )
  )

  const noteList = (
    notes === null ? (
      notesErr ? <p className="acct-note-empty">Couldn't load notifications.</p> : <div className="acct-note-loading" aria-busy="true"><span className="skeleton" /><span className="skeleton" /></div>
    ) : notes.length === 0 ? (
      <p className="acct-note-empty">You're all caught up.</p>
    ) : (
      <ul className="acct-notes">
        {notes.map((n) => {
          const body = (
            <>
              <span className={cx('acct-note-dot', !n.read && 'new')} aria-hidden="true"><Icon name="bell" size={16} /></span>
              <span className="acct-note-body">
                <span>{n.text}</span>
                <span className="acct-note-time">{!n.read && <strong>New · </strong>}{ago(n.created_at, now, true)}</span>
              </span>
            </>
          )
          return (
            <li key={n.id}>
              {n.listing_id ? <Link to={`/listing/${n.listing_id}`} className="acct-note">{body}</Link> : <div className="acct-note">{body}</div>}
            </li>
          )
        })}
      </ul>
    )
  )

  const MENU: { label: string; icon: IconName; note?: string | number; to?: string; onClick?: () => void }[] = [
    { label: 'Notifications', icon: 'bell', note: newNotes ? `${newNotes} new` : '', onClick: () => setShowNotes(true) },
    { label: 'Saved searches', icon: 'search', to: '/search' },
    { label: 'Boost my ads', icon: 'zap', onClick: soon('Boosting is') },
    { label: 'Payouts & UPI', icon: 'wallet', onClick: soon('Payouts are') },
    { label: 'Ratings & reviews', icon: 'star', note: user.ratings, onClick: soon('Reviews are') },
    { label: 'Help & safety', icon: 'shield', onClick: soon('Help centre is') },
  ]

  const NAV: { id?: Tab; label: string; icon: IconName; count?: number | string; to?: string; onClick?: () => void }[] = [
    { id: 'ads', label: 'My listings', icon: 'tag', count: data.listings.length },
    { id: 'watch', label: 'Watchlist', icon: 'heart', count: data.watching.length },
    { id: 'bought', label: 'Bought & won', icon: 'bag', count: data.bought.length || '' },
    { id: 'notes', label: 'Notifications', icon: 'bell', count: newNotes ? `${newNotes} new` : '' },
    { label: 'Saved searches', icon: 'search', to: '/search' },
    { label: 'Messages', icon: 'chat', to: '/chats', count: data.unread_chats || '' },
    { label: 'Ratings', icon: 'star', count: user.ratings, onClick: soon('Reviews are') },
    { label: 'Payouts', icon: 'wallet', onClick: soon('Payouts are') },
    { label: 'Settings', icon: 'cog', onClick: soon('Settings are') },
  ]

  const HEAD: Record<Tab, string> = { ads: 'My listings', watch: 'Watchlist', bought: 'Bought & won', notes: 'Notifications' }

  return (
    <div className="acct">
      {/* ================= Phone ================= */}
      <div className="m-only">
        <header className="acct-hero">
          <div className="acct-id">
            <span className="acct-avatar display" aria-hidden="true">{user.initials}</span>
            <span className="acct-who">
              <h1 className="display">{user.name}{user.verified && <VerifiedMark size={18} />}</h1>
              <span>{user.city} · member since {user.member_since}</span>
            </span>
            <button type="button" className="acct-cog" aria-label="Settings" onClick={soon('Settings are')}><Icon name="cog" size={20} width={1.8} /></button>
          </div>
          <dl className="acct-stats">
            <div><dt>positive</dt><dd className="display">{Math.round(user.positive)}%</dd></div>
            <div><dt>ratings</dt><dd className="display">{user.ratings}</dd></div>
            <div><dt>earned</dt><dd className="display">{inr(data.earned)}</dd></div>
          </dl>
        </header>

        <div className="acct-body">
          <div role="tablist" aria-label="My items" className="seg">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" id={`acct-tab-${id}`} aria-selected={phoneTab === id} aria-controls="acct-panel-m" className={cx('seg-btn', phoneTab === id && 'on')} onClick={() => pick(id)}>{label}</button>
            ))}
          </div>

          <div id="acct-panel-m" role="tabpanel" aria-labelledby={`acct-tab-${phoneTab}`} aria-busy={loading || undefined} className="acct-rows">
            {phoneTab === 'ads' && draft && (
              <Link to="/sell" className="acct-draft">
                <Icon name="edit" size={18} stroke="#7A6420" />
                <span><strong>Finish your draft</strong><span>{draft.title || 'Untitled'} · {draftPrice}</span></span>
                <Icon name="right" size={16} width={2.2} />
              </Link>
            )}
            {rows.length === 0 ? empty('m') : rows.map((l) => (
              <div key={l.id} className="acct-row card-hover">
                <Link to={`/listing/${l.id}`} className="acct-row-link">
                  <Thumb listing={l} className="acct-row-img" size={28} />
                  <span className="acct-row-body">
                    <span className="acct-row-title">{l.title}</span>
                    <span className="acct-row-price"><strong>{priceOf(l)}</strong> <span>· {status(l)}</span></span>
                    <span className="acct-row-meta">{meta(l)}</span>
                  </span>
                  {phoneTab !== 'watch' && <Icon name="right" size={16} stroke="#5B665F" width={2.2} />}
                </Link>
                {phoneTab === 'watch' && (
                  <button type="button" className="acct-unwatch" aria-label={`Remove ${l.title} from watchlist`} onClick={() => unwatch(l)}>
                    <Icon name="heart" size={20} fill="#C43D19" stroke="#C43D19" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <nav aria-label="Account" className="acct-menu">
            {MENU.map((m) => {
              const inner = (
                <>
                  <Icon name={m.icon} size={20} stroke="#1E5B43" width={1.8} />
                  <span className="acct-menu-label">{m.label}</span>
                  {m.note !== undefined && m.note !== '' && <span className={cx('acct-menu-note', m.label === 'Notifications' && 'hot')}>{m.note}</span>}
                  <Icon name="right" size={16} stroke="#9AA39D" width={2.2} />
                </>
              )
              return m.to ? <Link key={m.label} to={m.to} className="acct-menu-item">{inner}</Link>
                : <button key={m.label} type="button" className="acct-menu-item" onClick={m.onClick}>{inner}</button>
            })}
          </nav>
        </div>
      </div>

      {/* ================= Desktop ================= */}
      <div className="d-only wrap acct-d">
        <aside className="acct-side">
          <div className="acct-card acct-profile">
            <span className="acct-avatar display" aria-hidden="true">{user.initials}</span>
            <div className="acct-who">
              <strong>{user.name}</strong>
              <span>Member since {user.member_since} · {user.city}</span>
            </div>
            {user.verified && (
              <div className="acct-tags"><span>Phone verified</span><span>KYC verified</span></div>
            )}
          </div>
          <nav aria-label="My Haat" className="acct-card acct-nav">
            {NAV.map((n) => {
              const on = n.id === tab
              const inner = (
                <>
                  <Icon name={n.icon} size={20} width={1.8} />
                  <span className="acct-nav-label">{n.label}</span>
                  {n.count !== undefined && n.count !== '' && <span className={cx('acct-nav-count', n.id === 'notes' && newNotes > 0 && 'hot')}>{n.count}</span>}
                </>
              )
              if (n.to) return <Link key={n.label} to={n.to} className="acct-nav-item">{inner}</Link>
              return (
                <button key={n.label} type="button" className={cx('acct-nav-item', on && 'on')} aria-current={on ? 'page' : undefined}
                  onClick={n.id ? () => pick(n.id!) : n.onClick}>{inner}</button>
              )
            })}
          </nav>
        </aside>

        <section className="acct-main" aria-labelledby="acct-h">
          <div className="acct-main-head">
            <h1 id="acct-h" className="display">{HEAD[tab]}</h1>
            <Link to="/sell" className="btn ghost round acct-new"><Icon name="plus" size={18} width={2.4} />New listing</Link>
          </div>

          <div className="acct-cards">
            <div className="acct-card acct-stat"><span>Active listings</span><strong className="display">{data.listings.length}</strong><em>{featured ? `${featured} featured` : 'None featured yet'}</em></div>
            <div className="acct-card acct-stat"><span>Views</span><strong className="display">{views.toLocaleString('en-IN')}</strong><em>{plural(chats, 'chat')} with buyers</em></div>
            <div className="acct-card acct-stat"><span>Watching</span><strong className="display">{watchers}</strong><em>Across your listings</em></div>
            <div className="acct-card acct-stat"><span>Earned</span><strong className="display">{inr(data.earned)}</strong><em>{Math.round(user.positive)}% positive · {user.ratings} ratings</em></div>
          </div>

          {tab !== 'notes' && notes && newNotes > 0 && (
            <button type="button" className="acct-card acct-news" onClick={() => pick('notes')}>
              <span className="acct-note-dot new" aria-hidden="true"><Icon name="bell" size={16} /></span>
              <span className="acct-news-text"><strong>{plural(newNotes, 'new notification')}</strong><span>{notes.find((n) => !n.read)?.text}</span></span>
              <span className="acct-news-go">View all <Icon name="right" size={16} width={2.2} /></span>
            </button>
          )}

          {tab === 'notes' ? (
            <div className="acct-card acct-notes-card" aria-busy={notes === null || undefined}>
              {noteList}
            </div>
          ) : (
            <>
              <div className="acct-tabs">
                {tab === 'ads' ? (
                  <>
                    <span className="acct-tab on" aria-current="true">Active <span>{data.listings.length}</span></span>
                    <Link to="/sell" className="acct-tab">Drafts <span>{draft ? 1 : 0}</span></Link>
                  </>
                ) : (
                  <span className="acct-tab on" aria-current="true">{tab === 'watch' ? 'Watching' : 'Bought & won'} <span>{rows.length}</span></span>
                )}
              </div>

              <div className="acct-list" aria-busy={loading || undefined}>
                {tab === 'ads' && draft && (
                  <article className="acct-card acct-item draft">
                    <span className="acct-item-img acct-draft-img"><Icon name="edit" size={30} stroke="#7A6420" width={1.5} /></span>
                    <div className="acct-item-body">
                      <span className="acct-item-title-row"><span className="acct-item-title">{draft.title || 'Untitled draft'}</span><span className="acct-flag draft">DRAFT</span></span>
                      <span className="acct-item-price"><strong>{draftPrice}</strong> <span>· saved on this device</span></span>
                    </div>
                    <div className="acct-actions"><Link to="/sell" className="acct-act dark">Continue editing</Link></div>
                  </article>
                )}
                {rows.length === 0 ? <div className="acct-card acct-empty">{empty('d')}</div> : rows.map((l) => (
                  <article key={l.id} className="acct-card acct-item">
                    <Link to={`/listing/${l.id}`} aria-label={l.title} tabIndex={-1} className="acct-item-img-link"><Thumb listing={l} className="acct-item-img" size={36} /></Link>
                    <div className="acct-item-body">
                      <span className="acct-item-title-row">
                        <Link to={`/listing/${l.id}`} className="acct-item-title">{l.title}</Link>
                        {l.featured && <span className="acct-flag">FEATURED</span>}
                      </span>
                      <span className="acct-item-price"><strong>{priceOf(l)}</strong> <span>· {tab === 'bought' ? status(l) : longStatus(l, now)}</span></span>
                      {tab === 'ads' ? (
                        <span className="acct-item-stats">
                          <span><Icon name="eye" size={15} />{plural(l.views, 'view')}</span>
                          <span><Icon name="heart" size={15} />{l.watchers ?? 0} watching</span>
                          <span><Icon name="chat" size={15} />{plural(l.chats ?? 0, 'chat')}</span>
                        </span>
                      ) : (
                        <span className="acct-item-stats"><span><Icon name={tab === 'watch' ? 'pin' : 'user'} size={15} />{meta(l)}</span></span>
                      )}
                    </div>
                    <div className="acct-actions">
                      {tab === 'ads' && (
                        <>
                          <Link to={`/listing/${l.id}`} className="acct-act">View</Link>
                          <button type="button" className="acct-act boost" onClick={soon('Boosting is')}><Icon name="zap" size={15} />Boost</button>
                          <button type="button" className="acct-act dark" onClick={() => share(l)}><Icon name="share" size={15} />Share</button>
                        </>
                      )}
                      {tab === 'watch' && (
                        <>
                          <Link to={`/listing/${l.id}`} className="acct-act">View</Link>
                          <button type="button" className="acct-act" onClick={() => unwatch(l)} aria-label={`Remove ${l.title} from watchlist`}>
                            <Icon name="heart" size={15} fill="#C43D19" stroke="#C43D19" />Remove
                          </button>
                        </>
                      )}
                      {tab === 'bought' && <Link to={`/listing/${l.id}`} className="acct-act">View</Link>}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {showNotes && (
        <Sheet title="Notifications" onClose={() => setShowNotes(false)}>
          <div className="acct-sheet-notes">{noteList}</div>
        </Sheet>
      )}

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

function AccountSkeleton() {
  return (
    <div className="acct" aria-busy="true" aria-label="Loading your account">
      <div className="m-only">
        <div className="acct-hero">
          <div className="acct-id"><span className="acct-avatar skeleton" /><span className="skeleton acct-sk-line" /></div>
          <div className="acct-stats">{[0, 1, 2].map((i) => <span key={i} className="skeleton acct-sk-stat" />)}</div>
        </div>
        <div className="skeletons"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
      </div>
      <div className="d-only wrap acct-d">
        <aside className="acct-side"><span className="skeleton acct-sk-side" /></aside>
        <section className="acct-main">
          <div className="acct-cards">{[0, 1, 2, 3].map((i) => <span key={i} className="skeleton acct-sk-card" />)}</div>
          <div className="skeletons" style={{ padding: 0 }}><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
        </section>
      </div>
    </div>
  )
}
