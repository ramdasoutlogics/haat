import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Listing as Item } from '../api'
import { Avatar, Badge, ErrorBox, ListingCard, Sheet, Stepper, Toast, VerifiedMark } from '../components/ui'
import { Icon } from '../icons'
import { ago, closesAt, cx, inr, thumbFor, timeLeft } from '../lib'
import { usePageData, useNow, type LoadArgs } from '../ssr'

interface ListingData {
  listing: Item
  similar: Item[]
}

export async function load({ params }: LoadArgs): Promise<ListingData> {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id < 1) throw new Error('Listing not found')
  const listing = await api.listing(id)
  // Same category first, topped up with what's nearest so the row is never empty.
  const [same, near] = await Promise.all([
    api.listings({ category: listing.category, limit: 5 }).catch(() => null),
    api.listings({ sort: 'nearest', limit: 8 }).catch(() => null),
  ])
  const seen = new Set([listing.id])
  const similar = [...(same?.items ?? []), ...(near?.items ?? [])]
    .filter((l) => !seen.has(l.id) && !!seen.add(l.id))
    .slice(0, 4)
  return { listing, similar }
}

export function title(data: ListingData) {
  return data.listing.title
}

/** Placeholder photo tones until listings have real photos (as in the design). */
const TONES: [string, string][] = [['#EDE6F2', '#6A4F86'], ['#E5ECF4', '#3B5E86'], ['#E6EFE9', '#2F6A52'], ['#F5EED6', '#7A6420'], ['#F7E7DC', '#9A4A2B'], ['#E9EEE3', '#56703A']]
const PHOTOS = 4
function photosFor(l: Item) {
  const t = thumbFor(l)
  const rest = TONES.filter(([tone]) => tone !== t.tone)
  return [[t.tone, t.ink] as [string, string], ...rest].slice(0, PHOTOS).map(([tone, ink]) => ({ tone, ink, icon: t.icon }))
}

const pct = (n: number) => `${Math.round(n * 10) / 10}%`
const km = (n: number) => (n < 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n)))
const round = (n: number, step = 500) => Math.max(step, Math.round(n / step) * step)
const stepFor = (price: number) => (price >= 20000 ? 500 : price >= 2000 ? 100 : 50)

type SheetKind = 'bid' | 'offer' | 'buy'

export default function Listing() {
  const { data, setData, error, loading, reload } = usePageData(load)
  const navigate = useNavigate()
  const now = useNow()
  const [sheet, setSheet] = useState<SheetKind | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const flash = (msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }

  if (!data) {
    return (
      <div className="lst">
        {error ? (
          <div className="lst-missing wrap">
            <Link to="/search" className="icon-btn round soft" aria-label="Back to search"><Icon name="back" size={20} /></Link>
            <ErrorBox message={error} onRetry={/not found/i.test(error) ? undefined : reload} />
            <Link to="/search" className="btn ghost round">Browse listings</Link>
          </div>
        ) : <ListingSkeleton />}
      </div>
    )
  }

  const l = data.listing
  const seller = l.seller
  const isAuction = l.format === 'auction'
  const closed = l.status !== 'active' || (isAuction && timeLeft(l.closes_at, now) === 'Closed')
  const minBid = l.min_bid ?? (l.current_bid ?? l.price) + 500
  const buyPrice = isAuction ? l.buy_now : l.format === 'fixed' ? l.price : null
  const asking = isAuction ? l.buy_now ?? l.current_bid ?? l.price : l.price
  const leading = isAuction && !!l.you_lead

  const setListing = (next: Item) => setData({ ...data, listing: { ...l, ...next } })

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setActionError(null)
    try {
      await fn()
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const placeBid = (amount: number) => run('bid', async () => {
    const next = await api.bid(l.id, amount)
    setListing(next)
    setSheet(null)
    flash(`Bid placed · ${inr(amount)}`)
  })
  const sendOffer = (amount: number, note?: string) => run('offer', async () => {
    const { chat_id } = await api.offer(l.id, amount)
    if (note?.trim()) await api.send(chat_id, note.trim()).catch(() => {})
    navigate(`/chats/${chat_id}`)
  })
  const openChat = () => run('chat', async () => {
    const { chat_id } = await api.openChat(l.id)
    navigate(`/chats/${chat_id}`)
  })
  const toggleWatch = async () => {
    const was = l.watched
    setListing({ ...l, watched: !was, watchers: (l.watchers ?? 0) + (was ? -1 : 1) })
    try {
      const r = await api.watch(l.id, !was)
      setListing({ ...l, watched: r.watched, watchers: (l.watchers ?? 0) + (r.watched === was ? 0 : r.watched ? 1 : -1) })
      flash(r.watched ? 'Added to your watchlist' : 'Removed from your watchlist')
    } catch {
      setListing({ ...l, watched: was })
      flash("Couldn't update your watchlist")
    }
  }
  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title: l.title, url })
        return
      }
      await navigator.clipboard.writeText(url)
      flash('Link copied')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') flash("Couldn't share this link")
    }
  }
  const openSheet = (k: SheetKind) => {
    setActionError(null)
    setSheet(k)
  }

  const badges = (big?: boolean) => (
    <div className={cx('lst-badges', big && 'big')}>
      {isAuction && <Badge kind="auc" big>AUCTION</Badge>}
      {l.format === 'fixed' && <Badge kind="buy" big>{big ? 'BUY NOW' : `BUY NOW ${inr(l.price)}`}</Badge>}
      {isAuction && l.buy_now && <Badge kind="buy" big>{big ? 'BUY NOW AVAILABLE' : `BUY NOW ${inr(l.buy_now)}`}</Badge>}
      {l.format === 'free' ? <Badge kind="buy" big>FREE</Badge> : <Badge kind="neg" big>{big ? 'OFFERS WELCOME' : 'OFFERS'}</Badge>}
      {l.featured && <span className="lst-feat">FEATURED</span>}
    </div>
  )

  const description = (l.description ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const specs = l.specs?.length ? l.specs : [{ k: 'Condition', v: l.condition }]
  const sellerStats = seller && `${pct(seller.positive)} positive · ${seller.ratings} ratings${seller.reply_time ? ` · replies in ${seller.reply_time}` : ''}`

  return (
    <div className={cx('lst', loading && 'lst-loading')}>
      {/* ================= Phone ================= */}
      <div className="m-only lst-m">
        <Gallery listing={l} onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/search'))} onShare={share} onWatch={toggleWatch} />

        <div className="lst-m-body">
          {badges()}
          <h1 className="display lst-m-title">{l.title}</h1>

          <div className="lst-pricebox">
            {isAuction ? (
              <>
                <div className="lst-pb-col">
                  <span className="lst-pb-k">{l.current_bid ? `Current bid · ${l.bids_count} ${l.bids_count === 1 ? 'bid' : 'bids'}` : 'Starting bid · no bids yet'}</span>
                  <strong className="display lst-pb-v">{inr(l.current_bid ?? l.price)}</strong>
                  {!closed && <span className="lst-pb-ok">Next bid from {inr(minBid)}</span>}
                </div>
                <div className="lst-pb-col end">
                  <span className="lst-pb-k">{closed ? 'Auction' : 'Closes in'}</span>
                  <strong className="lst-pb-left">{closed ? 'Closed' : timeLeft(l.closes_at, now)}</strong>
                  <span className="lst-pb-sub">{closesAt(l.closes_at)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="lst-pb-col">
                  <span className="lst-pb-k">{l.format === 'fixed' ? 'Buy Now price' : l.format === 'free' ? 'Free to a good home' : 'Asking price'}</span>
                  <strong className="display lst-pb-v">{l.format === 'free' ? 'Free' : inr(l.price)}</strong>
                  <span className="lst-pb-ok">{l.format === 'free' ? 'Just pick it up' : 'Open to offers'}</span>
                </div>
                <div className="lst-pb-col end">
                  <span className="lst-pb-k">Listed</span>
                  <strong className="lst-pb-listed">{ago(l.created_at, now, true)}</strong>
                  <span className="lst-pb-sub">{l.views} views</span>
                </div>
              </>
            )}
          </div>
          {leading && !l.mine && <div role="status" className="status-ok">You're the highest bidder at {inr(l.current_bid ?? 0)}</div>}

          {seller && (
            <SellerLink mine={l.mine} className="lst-seller">
              <Avatar initials={seller.initials} size={48} />
              <span className="lst-seller-text">
                <strong>{seller.name}{seller.verified && <VerifiedMark />}</strong>
                <span>{sellerStats}</span>
              </span>
              {l.mine && <Icon name="right" size={18} stroke="#5B665F" width={2.2} />}
            </SellerLink>
          )}

          <section aria-labelledby="lst-m-det" className="lst-m-sec">
            <h2 id="lst-m-det">Details</h2>
            <dl className="lst-m-specs">
              {specs.map((s) => <div key={s.k}><dt>{s.k}</dt><dd>{s.v}</dd></div>)}
            </dl>
          </section>
          {description.length > 0 && (
            <section aria-labelledby="lst-m-desc" className="lst-m-sec">
              <h2 id="lst-m-desc">Description</h2>
              {description.map((p, i) => <p key={i} className="lst-desc">{p}</p>)}
            </section>
          )}
          <div className="lst-m-loc">
            <Icon name="pin" size={20} stroke="#1E5B43" />
            <span>{l.location} · {km(l.distance_km)} km away</span>
            <strong>Pick up or courier</strong>
          </div>
        </div>

        <div className="lst-bar">
          {l.mine ? (
            <div className="lst-mine-bar">
              <span>
                <strong>This is your listing</strong>
                <span>{l.views} views · {l.watchers ?? 0} watching{isAuction ? ` · ${l.bids_count} bids` : ''}</span>
              </span>
              <Link to="/account" className="btn dark sm">Manage</Link>
            </div>
          ) : (
            <>
              <button type="button" className="lst-chat" aria-label="Chat with seller" onClick={openChat} disabled={busy === 'chat'}>
                <Icon name="chat" size={22} />
              </button>
              {l.format === 'free' ? (
                <button type="button" className="btn primary lst-go" onClick={openChat} disabled={busy === 'chat'}>Ask for it</button>
              ) : (
                <>
                  <button type="button" className={cx('btn lst-go', l.format === 'offer' ? 'primary' : 'ghost')} onClick={() => openSheet('offer')} disabled={closed}>Make offer</button>
                  {isAuction && <button type="button" className="btn primary lst-go wide" onClick={() => openSheet('bid')} disabled={closed}>{closed ? 'Auction closed' : 'Place bid'}</button>}
                  {l.format === 'fixed' && <button type="button" className="btn primary lst-go wide" onClick={() => openSheet('buy')}>Buy now</button>}
                </>
              )}
            </>
          )}
          {actionError && !sheet && <span role="alert" className="status-err lst-bar-err">{actionError}</span>}
        </div>
      </div>

      {/* ================= Desktop ================= */}
      <div className="d-only wrap lst-d">
        <nav aria-label="Breadcrumb" className="lst-crumbs">
          <Link to="/search">Back to results</Link><span aria-hidden="true">·</span>
          <Link to="/">Marketplace</Link><span aria-hidden="true">/</span>
          <Link to={`/search?category=${encodeURIComponent(l.category)}`}>{l.category}</Link><span aria-hidden="true">/</span>
          <span className="here">{l.title}</span>
        </nav>

        <div className="lst-cols">
          <div className="lst-main">
            <DesktopGallery listing={l} />

            <section className="lst-head">
              {badges(true)}
              <h1 className="display">{l.title}</h1>
              <div className="lst-meta">
                <span>{l.location}, Bengaluru</span>
                <span>Listed {ago(l.created_at, now, true)}</span>
                <span>Listing #{l.id}</span>
                <span>{l.views} views · {l.watchers ?? 0} watching</span>
              </div>
            </section>

            <section aria-labelledby="lst-det" className="lst-card">
              <h2 id="lst-det" className="display">Details</h2>
              <dl className="lst-specs">
                {specs.map((s) => <div key={s.k}><dt>{s.k}</dt><dd>{s.v}</dd></div>)}
              </dl>
            </section>

            {description.length > 0 && (
              <section aria-labelledby="lst-desc" className="lst-card">
                <h2 id="lst-desc" className="display">Description</h2>
                {description.map((p, i) => <p key={i} className="lst-desc">{p}</p>)}
              </section>
            )}

            <section aria-labelledby="lst-ship" className="lst-card lst-ship">
              <div className="lst-ship-rows">
                <h2 id="lst-ship" className="display">Pick up &amp; delivery</h2>
                <div><span>Pick up from {l.location}</span><strong>Free</strong></div>
                <div><span>Distance from you</span><strong>{km(l.distance_km)} km</strong></div>
                <div><span>Courier or Haat Pay</span><strong>Agree in chat</strong></div>
              </div>
              <div role="img" aria-label={`Approximate pick-up area: ${l.location}`} className="lst-map">
                <span className="lst-map-ring" />
                <span className="lst-map-tag">{l.location} · approximate area</span>
              </div>
            </section>
          </div>

          <aside className="lst-side">
            <section aria-label={l.mine ? 'Your listing' : 'Buy'} className="lst-buy">
              {l.mine ? (
                <MineBox listing={l} />
              ) : (
                <>
                  {isAuction && (
                    <div className="lst-clock">
                      <span><Icon name="clock" size={18} width={2.2} />{closed ? 'Auction closed' : `Closes in ${timeLeft(l.closes_at, now)}`}</span>
                      <span className="lst-clock-at">{closesAt(l.closes_at)}</span>
                    </div>
                  )}
                  <div className="lst-buy-price">
                    <div>
                      <span className="lst-pb-k">{isAuction ? (l.current_bid ? 'Current bid' : 'Starting bid') : l.format === 'fixed' ? 'Buy Now price' : l.format === 'free' ? 'Price' : 'Asking price'}</span>
                      <strong className="display">{isAuction ? inr(l.current_bid ?? l.price) : l.format === 'free' ? 'Free' : inr(l.price)}</strong>
                    </div>
                    <div className="lst-buy-side">
                      {isAuction ? (
                        <>
                          {!closed && <span className="ok">Next bid {inr(minBid)}</span>}
                          <span>{l.bids_count} {l.bids_count === 1 ? 'bid' : 'bids'}</span>
                        </>
                      ) : <span className="ok">{l.format === 'free' ? 'Just pick it up' : 'Open to offers'}</span>}
                    </div>
                  </div>

                  {isAuction && !closed && (
                    <BidForm key={minBid} min={minBid} busy={busy === 'bid'} onBid={placeBid} />
                  )}
                  {leading && <div role="status" className="status-ok lst-lead"><Icon name="check" size={18} width={2.6} />You're the highest bidder</div>}
                  {actionError && !sheet && <div role="alert" className="status-err">{actionError}</div>}

                  {isAuction && buyPrice && !closed && <div className="lst-or">or skip the auction</div>}
                  {buyPrice && !closed && (
                    <button type="button" className="btn primary lst-big" onClick={() => openSheet('buy')}>Buy Now · {inr(buyPrice)}</button>
                  )}
                  {l.format === 'free' && (
                    <button type="button" className="btn primary lst-big" onClick={openChat} disabled={busy === 'chat'}>Ask for it</button>
                  )}
                  <div className="lst-two">
                    {l.format !== 'free' && <OfferToggle listing={l} asking={asking} busy={busy === 'offer'} disabled={closed} onSend={sendOffer} />}
                    <button type="button" className="btn ghost lst-mid" onClick={openChat} disabled={busy === 'chat'}><Icon name="chat" size={18} />Chat</button>
                  </div>
                  <div className="lst-two small">
                    <button type="button" className="lst-soft" aria-pressed={l.watched} onClick={toggleWatch}>
                      <Icon name="heart" size={18} fill={l.watched ? '#C43D19' : 'none'} stroke={l.watched ? '#C43D19' : 'currentColor'} />{l.watched ? 'Watching' : 'Watchlist'}
                    </button>
                    <button type="button" className="lst-soft" onClick={share}><Icon name="share" size={18} />Share</button>
                  </div>
                  <span className="lst-protect"><Icon name="shield" size={16} stroke="#1E5B43" />Covered by buyer protection with Haat Pay</span>
                </>
              )}
            </section>

            {seller && (
              <section aria-label="Seller" className="lst-sellercard">
                <div className="lst-sc-top">
                  <Avatar initials={seller.initials} size={56} />
                  <div>
                    <span className="lst-sc-name">{seller.name}{seller.verified && <VerifiedMark size={18} />}</span>
                    <span className="muted">Member since {seller.member_since} · {seller.city}</span>
                  </div>
                </div>
                <div className="lst-sc-stats">
                  <div><strong>{pct(seller.positive)}</strong><span>positive</span></div>
                  <div><strong>{seller.ratings}</strong><span>ratings</span></div>
                  <div><strong>{seller.reply_time ?? '—'}</strong><span>replies</span></div>
                </div>
                {seller.verified && (
                  <div className="lst-sc-tags"><span>Phone verified</span><span>KYC verified</span></div>
                )}
              </section>
            )}

            <section aria-labelledby="lst-safe" className="lst-safe">
              <h2 id="lst-safe">Stay safe</h2>
              <ul>
                <li>Meet in a public place and inspect before paying.</li>
                <li>Keep chats on Haat — never share your OTP or UPI PIN.</li>
                <li>Be wary of deals that need urgent payment.</li>
              </ul>
            </section>
          </aside>
        </div>

        {data.similar.length > 0 && (
          <section aria-labelledby="lst-sim" className="lst-similar">
            <h2 id="lst-sim" className="display">Similar near you</h2>
            <div className="lst-sim-grid">
              {data.similar.map((s) => <ListingCard key={s.id} listing={s} />)}
            </div>
          </section>
        )}
      </div>

      {sheet && (
        <AmountSheet
          kind={sheet}
          listing={l}
          minBid={minBid}
          asking={asking}
          buyPrice={buyPrice}
          busy={busy === 'bid' || busy === 'offer'}
          error={actionError}
          onClose={() => setSheet(null)}
          onConfirm={(amount) => (sheet === 'bid' ? placeBid(amount) : sendOffer(amount))}
        />
      )}
      {toast && <Toast>{toast}</Toast>}
    </div>
  )
}

function SellerLink({ mine, className, children }: { mine: boolean; className: string; children: React.ReactNode }) {
  return mine ? <Link to="/account" className={className}>{children}</Link> : <div className={className}>{children}</div>
}

/** Phone hero: swipeable photo strip with dots, and back/share/watch buttons. */
function Gallery({ listing, onBack, onShare, onWatch }: { listing: Item; onBack: () => void; onShare: () => void; onWatch: () => void }) {
  const photos = photosFor(listing)
  const [at, setAt] = useState(0)
  const strip = useRef<HTMLDivElement>(null)
  const go = (i: number) => {
    const el = strip.current
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
    setAt(i)
  }
  return (
    <div className="lst-hero">
      <div ref={strip} className="lst-strip" onScroll={(e) => {
        const el = e.currentTarget
        setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
      }}>
        {photos.map((p, i) => (
          <div key={i} className="lst-slide" style={{ background: p.tone }} aria-hidden={i !== at}>
            <Icon name={p.icon} size={120} stroke={p.ink} width={0.9} />
          </div>
        ))}
      </div>
      <div className="lst-hero-btns">
        <button type="button" className="icon-btn round white" aria-label="Back" onClick={onBack}><Icon name="back" size={20} width={2.2} /></button>
        <span>
          <button type="button" className="icon-btn round white" aria-label="Share" onClick={onShare}><Icon name="share" size={19} /></button>
          {!listing.mine && (
            <button type="button" className="icon-btn round white" aria-label={listing.watched ? 'Remove from watchlist' : 'Add to watchlist'} aria-pressed={listing.watched} onClick={onWatch}>
              <Icon name="heart" size={20} fill={listing.watched ? '#C43D19' : 'none'} stroke={listing.watched ? '#C43D19' : '#16211C'} />
            </button>
          )}
        </span>
      </div>
      <div role="tablist" aria-label="Photos" className="lst-dots">
        {photos.map((_, i) => (
          <button key={i} type="button" role="tab" aria-label={`Photo ${i + 1}`} aria-selected={i === at} onClick={() => go(i)}>
            <span className={cx(i === at && 'on')} />
          </button>
        ))}
      </div>
    </div>
  )
}

function DesktopGallery({ listing }: { listing: Item }) {
  const photos = photosFor(listing)
  const [at, setAt] = useState(0)
  const p = photos[at]
  return (
    <section aria-label="Photos" className="lst-gallery">
      <div className="lst-stage" style={{ background: p.tone }}>
        <Icon name={p.icon} size={140} stroke={p.ink} width={0.9} />
        {listing.featured && <Badge kind="feat">FEATURED</Badge>}
        <span className="lst-count">{at + 1} / {photos.length}</span>
        <button type="button" className="lst-nav prev" aria-label="Previous photo" onClick={() => setAt((at + photos.length - 1) % photos.length)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16211C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <button type="button" className="lst-nav next" aria-label="Next photo" onClick={() => setAt((at + 1) % photos.length)}>
          <Icon name="right" size={20} width={2.2} />
        </button>
      </div>
      <div className="lst-thumbs">
        {photos.map((t, i) => (
          <button key={i} type="button" aria-label={`Photo ${i + 1}`} aria-pressed={i === at} className={cx(i === at && 'on')} style={{ background: t.tone }} onClick={() => setAt(i)}>
            <Icon name={t.icon} size={28} stroke={t.ink} width={1.4} />
          </button>
        ))}
      </div>
    </section>
  )
}

function BidForm({ min, busy, onBid }: { min: number; busy: boolean; onBid: (n: number) => void }) {
  const [value, setValue] = useState(min.toLocaleString('en-IN'))
  const [err, setErr] = useState<string | null>(null)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const n = Number(value.replace(/\D/g, ''))
    if (!n || n < min) {
      setErr(`Minimum bid is ${inr(min)}`)
      return
    }
    setErr(null)
    onBid(n)
  }
  return (
    <form className="lst-bidform" onSubmit={submit} noValidate>
      <div className="lst-bidrow">
        <label htmlFor="lst-bidamt" className="sr">Your bid</label>
        <div className="lst-bidinput">
          <span aria-hidden="true">₹</span>
          <input id="lst-bidamt" inputMode="numeric" value={value} aria-describedby="lst-bidhint"
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => { const n = Number(value.replace(/\D/g, '')); if (n) setValue(n.toLocaleString('en-IN')) }} />
        </div>
        <button type="submit" className="btn dark lst-bidbtn" disabled={busy}>{busy ? 'Bidding…' : 'Place bid'}</button>
      </div>
      <span id="lst-bidhint" className={cx('hint', err && 'lst-err')} role={err ? 'alert' : undefined}>
        {err ?? `Enter ${inr(min)} or more`}
      </span>
    </form>
  )
}

function OfferToggle({ listing, asking, busy, disabled, onSend }: { listing: Item; asking: number; busy: boolean; disabled: boolean; onSend: (n: number, note: string) => void }) {
  const [open, setOpen] = useState(false)
  const step = stepFor(asking)
  const chips = [...new Set([0.9, 0.93, 0.97].map((f) => round(asking * f, step)))]
  const [amount, setAmount] = useState(chips[1] ?? chips[0])
  const [note, setNote] = useState('')
  const sellerFirst = listing.seller?.name.split(' ')[0] ?? 'there'
  return (
    <>
      <button type="button" className="btn ghost lst-mid" aria-expanded={open} aria-controls="lst-offer" onClick={() => setOpen(!open)} disabled={disabled}>Make an offer</button>
      {open && (
        <form id="lst-offer" className="lst-offer" onSubmit={(e) => { e.preventDefault(); onSend(amount, note) }}>
          <strong>Your offer</strong>
          <div className="lst-offer-chips">
            {chips.map((c) => (
              <button key={c} type="button" aria-pressed={amount === c} className={cx('lst-ochip', amount === c && 'on')} onClick={() => setAmount(c)}>{inr(c)}</button>
            ))}
          </div>
          <Stepper value={amount} onChange={setAmount} step={step} min={step} format={inr} />
          <label htmlFor="lst-offer-msg" className="sr">Message to seller (optional)</label>
          <textarea id="lst-offer-msg" rows={2} className="lst-offer-msg" placeholder={`Hi ${sellerFirst}! Could you do ${inr(amount)}? I can pick up this weekend.`} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="btn dark" disabled={busy}>{busy ? 'Sending…' : `Send offer of ${inr(amount)}`}</button>
        </form>
      )}
    </>
  )
}

function MineBox({ listing: l }: { listing: Item }) {
  const now = useNow()
  return (
    <div className="lst-minebox">
      <div className="lst-mine-head"><Icon name="tag" size={18} stroke="#1E5B43" />This is your listing</div>
      <div className="lst-buy-price">
        <div>
          <span className="lst-pb-k">{l.format === 'auction' ? (l.current_bid ? 'Current bid' : 'Starting bid') : 'Your price'}</span>
          <strong className="display">{l.format === 'free' ? 'Free' : inr(l.current_bid ?? l.price)}</strong>
        </div>
        {l.format === 'auction' && <div className="lst-buy-side"><span className="ok">{l.closes_at ? `Closes in ${timeLeft(l.closes_at, now)}` : ''}</span><span>{closesAt(l.closes_at)}</span></div>}
      </div>
      <div className="lst-sc-stats">
        <div><strong>{l.views}</strong><span>views</span></div>
        <div><strong>{l.watchers ?? 0}</strong><span>watching</span></div>
        <div><strong>{l.format === 'auction' ? l.bids_count : l.chats ?? '—'}</strong><span>{l.format === 'auction' ? 'bids' : 'chats'}</span></div>
      </div>
      <Link to="/account" className="btn dark block">Manage in your account</Link>
      <span className="lst-protect">Buyers see bid, offer and chat buttons here.</span>
    </div>
  )
}

function AmountSheet({ kind, listing: l, minBid, asking, buyPrice, busy, error, onClose, onConfirm }: {
  kind: SheetKind
  listing: Item
  minBid: number
  asking: number
  buyPrice: number | null
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (amount: number) => void
}) {
  const step = stepFor(kind === 'bid' ? minBid : asking)
  const [amount, setAmount] = useState(() => (kind === 'bid' ? minBid : kind === 'buy' ? buyPrice ?? asking : round(asking * 0.93, step)))
  const reply = l.seller?.reply_time ? ` · seller usually replies in ${l.seller.reply_time}` : ''
  if (kind === 'buy') {
    return (
      <Sheet title="Buy now" onClose={onClose}>
        <div className="lst-sheet-buy">
          <strong className="display">{inr(amount)}</strong>
          <span>We'll send {l.seller?.name ?? 'the seller'} a full-price offer. Once they accept, pay safely with Haat Pay and arrange pick up in chat.</span>
        </div>
        {error && <div role="alert" className="status-err">{error}</div>}
        <button type="button" className="btn primary lst-sheet-go" disabled={busy} onClick={() => onConfirm(amount)}>{busy ? 'Sending…' : `Buy for ${inr(amount)}`}</button>
      </Sheet>
    )
  }
  return (
    <Sheet title={kind === 'bid' ? 'Place a bid' : 'Make an offer'} onClose={onClose}>
      <Stepper value={amount} onChange={setAmount} step={step} min={kind === 'bid' ? minBid : step} format={inr} />
      <span className="lst-sheet-hint">
        {kind === 'bid' ? `Minimum bid ${inr(minBid)} · ${l.bids_count} ${l.bids_count === 1 ? 'bid' : 'bids'} so far` : `Asking ${inr(asking)}${reply}`}
      </span>
      {error && <div role="alert" className="status-err">{error}</div>}
      <button type="button" className="btn dark lst-sheet-go" disabled={busy} onClick={() => onConfirm(amount)}>
        {busy ? 'Sending…' : kind === 'bid' ? `Bid ${inr(amount)}` : `Send offer · ${inr(amount)}`}
      </button>
    </Sheet>
  )
}

function ListingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading listing">
      <div className="m-only">
        <span className="skeleton lst-sk-hero" />
        <div className="skeletons"><span className="skeleton" style={{ height: 28, width: '60%' }} /><span className="skeleton" style={{ height: 34 }} /><span className="skeleton" /><span className="skeleton" /></div>
      </div>
      <div className="d-only wrap lst-cols lst-sk-d">
        <div className="lst-main"><span className="skeleton lst-sk-stage" /><span className="skeleton" style={{ height: 40, width: '70%' }} /><span className="skeleton" style={{ height: 160 }} /></div>
        <aside className="lst-side"><span className="skeleton" style={{ height: 380, borderRadius: 22 }} /></aside>
      </div>
    </div>
  )
}
