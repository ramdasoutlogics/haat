import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Format } from '../api'
import { Badge, Sheet, Thumb, Toast } from '../components/ui'
import { Icon, type IconName } from '../icons'
import { CATEGORIES, CATEGORY_LOOK, cx, inr } from '../lib'
import { usePageData } from '../ssr'

// No server data needed; a trivial loader lets the server set the page title.
export async function load() {
  return { ok: true }
}
export function title() {
  return 'Sell an item'
}

const DRAFT_KEY = 'haat.sell.draft'
const CONDITIONS = ['New', 'Used · excellent', 'Used · good', 'For parts']
const DURATIONS = [3, 5, 7, 10, 14]

const FORMATS: { id: Format; label: string; short: string; hint: string; icon: IconName }[] = [
  { id: 'fixed', label: 'Fixed price', short: 'Set a Buy Now price', hint: 'Set a Buy Now price.', icon: 'tag' },
  { id: 'auction', label: 'Auction', short: 'Bids for 7 days', hint: 'Bids for set days, with optional Buy Now.', icon: 'gavel' },
  { id: 'offer', label: 'Make an offer', short: 'Negotiate in chat', hint: 'Show an asking price and negotiate.', icon: 'chat' },
  { id: 'free', label: 'Free', short: 'Give it away', hint: 'Give it away to someone nearby.', icon: 'gift' },
]
const PRICE_LABEL: Record<Format, string> = {
  fixed: 'Buy Now price',
  auction: 'Start price',
  offer: 'Asking price',
  free: '',
}
const TAG: Record<Format, { label: string; kind: 'buy' | 'auc' | 'neg' }> = {
  fixed: { label: 'BUY NOW', kind: 'buy' },
  auction: { label: 'AUCTION', kind: 'auc' },
  offer: { label: 'OFFERS', kind: 'neg' },
  free: { label: 'FREE', kind: 'buy' },
}

/** Suggest a category from words in the title. */
const GUESS: [RegExp, string][] = [
  [/\b(i?phone|pixel|galaxy|oneplus|redmi|realme|vivo|oppo|mobile|smartphone)/i, 'Mobiles'],
  [/\b(laptop|macbook|camera|lens|tv|monitor|ipad|tablet|headphones?|speaker|playstation|ps5|xbox|printer|pc)\b/i, 'Tech'],
  [/\b(car|swift|sedan|suv|hatchback|maruti|hyundai|innova|creta|baleno)\b/i, 'Cars'],
  [/\b(bike|cycle|bicycle|scooter|activa|enfield|pulsar|splendor)\b/i, 'Bikes'],
  [/\b(flat|bhk|apartment|plot|pg|house|villa|room)\b/i, 'Property'],
  [/\b(sofa|table|chairs?|bed|wardrobe|dining|armchair|shelf|mattress|cupboard|fridge|washing)\b/i, 'Home'],
  [/\b(shirt|saree|kurta|shoes?|jacket|dress|jeans|lehenga|sneakers)\b/i, 'Fashion'],
  [/\b(dog|cat|puppy|kitten|aquarium|bird|pet)\b/i, 'Pets'],
]
const guessCategory = (t: string) => GUESS.find(([re]) => re.test(t))?.[1] ?? ''

interface Draft {
  title: string
  category: string
  picked: boolean
  format: Format
  price: string
  buyNow: string
  duration: number
  condition: string
  description: string
  location: string
}
const EMPTY: Draft = {
  title: '',
  category: '',
  picked: false,
  format: 'fixed',
  price: '',
  buyNow: '',
  duration: 7,
  condition: 'Used · good',
  description: '',
  location: 'Koramangala',
}

type Field = 'title' | 'category' | 'price' | 'buyNow' | 'location'
type Errors = Partial<Record<Field, string>>

function validate(d: Draft, category: string): Errors {
  const e: Errors = {}
  if (d.title.trim().length < 3) e.title = 'Add a title of at least 3 characters.'
  if (!category) e.category = 'Choose a category.'
  if (d.format !== 'free' && !(Number(d.price) >= 1)) e.price = 'Enter a price.'
  if (d.format === 'auction' && d.buyNow && Number(d.buyNow) <= Number(d.price)) e.buyNow = 'Buy Now should be higher than the start price.'
  if (!d.location.trim()) e.location = 'Add the area buyers can pick up from.'
  return e
}

/** Which fields each phone step owns, for "Next" validation. */
const STEP_FIELDS: Field[][] = [['title', 'category'], ['price', 'buyNow'], ['location'], []]
const STEP_NAMES = ['Photos & title', 'Format & price', 'Details', 'Review & post']
const NEXT_LABEL = ['Next: format & price', 'Next: details', 'Next: review', 'Post ad']

const digits = (v: string) => v.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9)
const grouped = (v: string) => (v ? Number(v).toLocaleString('en-IN') : '')

export default function Sell() {
  usePageData(load)
  const navigate = useNavigate()
  const [d, setD] = useState<Draft>(EMPTY)
  const [step, setStep] = useState(0)
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({})
  const [showAll, setShowAll] = useState(false)
  const [picking, setPicking] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [active, setActive] = useState(1)
  const [range, setRange] = useState<{ cat: string; lo: number; hi: number; n: number } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const category = d.picked ? d.category : guessCategory(d.title)
  const errors = useMemo(() => validate(d, category), [d, category])
  const shown = (f: Field) => (showAll || touched[f] ? errors[f] : undefined)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }))
  const touch = (f: Field) => setTouched((t) => ({ ...t, [f]: true }))
  const snapshot = JSON.stringify(d)

  // Restore a saved draft after mount (never during render: this page is server-rendered).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const restored = { ...EMPTY, ...JSON.parse(raw) } as Draft
      setD(restored)
      setSaved(JSON.stringify(restored))
      setToast('Draft restored')
    } catch {
      /* storage unavailable or corrupt: start fresh */
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(t)
  }, [toast])

  // Price guide from similar listings in the chosen category.
  useEffect(() => {
    if (!category || range?.cat === category) return
    let live = true
    api.listings({ category, limit: 40 }).then((p) => {
      const prices = p.items.filter((l) => l.format !== 'free').map((l) => l.current_bid ?? l.price).filter((n) => n > 1).sort((a, b) => a - b)
      if (!live) return
      if (!prices.length) return setRange({ cat: category, lo: 0, hi: 0, n: 0 })
      const q = (f: number) => prices[Math.min(prices.length - 1, Math.floor(f * (prices.length - 1)))]
      setRange({ cat: category, lo: prices.length >= 4 ? q(0.25) : prices[0], hi: prices.length >= 4 ? q(0.75) : prices[prices.length - 1], n: prices.length })
    }).catch(() => {})
    return () => { live = false }
  }, [category, range?.cat])

  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, category }))
      setSaved(JSON.stringify(d))
      setToast('Draft saved')
    } catch {
      setToast("Couldn't save the draft on this device")
    }
  }

  const focusFirst = (fields: Field[]) => {
    const first = fields.find((f) => errors[f])
    if (!first) return true
    const id = first === 'category' ? 'sell-cat-btn' : `sell-${first}`
    requestAnimationFrame(() => document.getElementById(id)?.focus())
    return false
  }

  const publish = async () => {
    setShowAll(true)
    if (!focusFirst(['title', 'category', 'price', 'buyNow', 'location'])) {
      // On phones jump back to the first step with a problem.
      const bad = STEP_FIELDS.findIndex((fs) => fs.some((f) => errors[f]))
      if (bad >= 0) setStep(bad)
      return
    }
    setBusy(true)
    setFailure(null)
    const body = {
      title: d.title.trim(),
      category,
      format: d.format,
      price: d.format === 'free' ? 0 : Number(d.price),
      buy_now: d.format === 'auction' && d.buyNow ? Number(d.buyNow) : null,
      condition: d.condition,
      description: d.description.trim(),
      duration_days: d.duration,
      location: d.location.trim(),
    }
    try {
      const l = await api.createListing(body)
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      navigate(`/listing/${l.id}`)
    } catch (e) {
      setFailure((e as Error).message)
      setBusy(false)
    }
  }

  const next = () => {
    if (step === 3) return publish()
    const fields = STEP_FIELDS[step]
    setTouched((t) => ({ ...t, ...Object.fromEntries(fields.map((f) => [f, true])) }))
    if (!focusFirst(fields)) return
    setStep(step + 1)
    window.scrollTo(0, 0)
  }
  const back = () => {
    if (step > 0) {
      setStep(step - 1)
      window.scrollTo(0, 0)
    } else if (window.history.length > 1) navigate(-1)
    else navigate('/')
  }
  const goStep = (n: number) => {
    setStep(n)
    window.scrollTo(0, 0)
  }

  const priceNum = Number(d.price) || 0
  const previewPrice = d.format === 'free' ? 'Free' : priceNum ? (d.format === 'auction' ? `${inr(priceNum)} start` : inr(priceNum)) : '₹ —'
  const look = { title: d.title || 'Your item', category: category || 'Tech' }
  const isDirty = saved !== snapshot
  const photoHint = 'Photo upload is coming soon. Until then your ad shows a placeholder picture for its category.'
  const noPhotos = () => setToast('Photo upload is coming soon')

  const err = (f: Field) => shown(f) && <span id={`sell-${f}-err`} className="sell-err">{shown(f)}</span>
  const aria = (f: Field) => ({ 'aria-invalid': !!shown(f) || undefined, 'aria-describedby': shown(f) ? `sell-${f}-err` : undefined })

  const done = [
    !errors.title && !errors.category,
    false,
    d.description.trim().length > 0,
    !errors.price && !errors.buyNow,
    !errors.location,
  ]
  const NAV = ['Title & category', 'Photos', 'Details', 'Price & format', 'Location']

  const preview = (
    <div className="sell-pv">
      <Thumb listing={look} className="sell-pv-img" size={70} />
      <div className="sell-pv-body">
        <span className="sell-pv-price"><strong className="display">{previewPrice}</strong><Badge kind={TAG[d.format].kind}>{TAG[d.format].label}</Badge></span>
        <span className="sell-pv-title">{d.title.trim() || 'Your title shows here'}</span>
        <span className="sell-pv-meta">{d.location.trim() || 'Your area'} · Just now</span>
      </div>
    </div>
  )

  return (
    <div className="sell">
      {/* ---------- Phone header ---------- */}
      <div className="m-only sell-top">
        <div className="sell-top-row">
          <Link to="/" className="icon-btn" aria-label="Close"><Icon name="close" size={22} width={2.2} /></Link>
          <h1 className="sell-top-title">Sell an item</h1>
          <button type="button" className="sell-link" onClick={saveDraft}>Save draft</button>
        </div>
        <div className="sell-progress" role="progressbar" aria-label={`Step ${step + 1} of 4: ${STEP_NAMES[step]}`} aria-valuemin={1} aria-valuemax={4} aria-valuenow={step + 1}>
          {[0, 1, 2, 3].map((i) => <span key={i} className={cx(i <= step && 'on')} />)}
        </div>
      </div>

      <div className="wrap sell-wrap">
        {/* ---------- Desktop heading ---------- */}
        <div className="d-only sell-head">
          <div>
            <h1 className="display">Post an ad</h1>
            <p>Listing is free. You can boost it for more views once it's live.</p>
          </div>
          <div className="sell-head-actions">
            <span className="sell-saved" aria-live="polite">{saved && !isDirty ? 'Draft saved' : saved ? 'Unsaved changes' : ''}</span>
            <button type="button" className="btn ghost round sm" onClick={saveDraft}>Save draft</button>
            <Link to="/" className="btn round sm sell-exit">Exit</Link>
          </div>
        </div>

        <div className="sell-layout">
          {/* ---------- Desktop step nav ---------- */}
          <nav aria-label="Steps" className="d-only sell-steps">
            <ol>
              {NAV.map((label, i) => (
                <li key={label}>
                  <a href={`#sell-s${i + 1}`} className={cx('sell-step', active === i + 1 && 'cur', done[i] && 'done')} aria-current={active === i + 1 ? 'step' : undefined}>
                    <span className="sell-step-dot">{done[i] ? <Icon name="check" size={14} width={3} /> : i + 1}</span>
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <form ref={formRef} className="sell-form" noValidate onSubmit={(e) => { e.preventDefault(); if (step === 3 || window.matchMedia('(min-width: 900px)').matches) publish(); else next() }}>
            {/* 1. Title & category (phone step 1) */}
            <section id="sell-s1" aria-labelledby="sell-h1" className={cx('sell-sec o1', step !== 0 && 'off')} onFocusCapture={() => setActive(1)}>
              <h2 id="sell-h1" className="d-only sell-h display">1. Title &amp; category</h2>
              <div className="field">
                <label htmlFor="sell-title">Title</label>
                <input id="sell-title" className="input" value={d.title} maxLength={80} placeholder="e.g. iPhone 13 128GB, midnight, unlocked"
                  onChange={(e) => set('title', e.target.value)} onBlur={() => touch('title')} {...aria('title')} />
                <span className="sell-row-hint">
                  {err('title') || <span />}
                  <span className="hint">{d.title.length} / 80</span>
                </span>
              </div>
              <div className={cx('sell-cat', !category && 'nocat')}>
                <Icon name={category ? CATEGORY_LOOK[category].icon : 'zap'} size={20} stroke="#1E5B43" />
                <span className="sell-cat-text">
                  {category ? (
                    <>{d.picked ? 'Category: ' : <><span className="d-only">Suggested from your title: </span><span className="m-only">Category: </span></>}<strong>{category}</strong></>
                  ) : 'Choose a category for your item'}
                </span>
                <button id="sell-cat-btn" type="button" className="sell-cat-btn" onClick={() => setPicking(true)} {...aria('category')}>{category ? 'Change' : 'Choose'}</button>
              </div>
              {err('category')}
            </section>

            {/* 2. Photos (phone step 1) */}
            <section id="sell-s2" aria-labelledby="sell-h2" className={cx('sell-sec o2', step !== 0 && 'off')} onFocusCapture={() => setActive(2)}>
              <div className="sell-sec-head">
                <h2 id="sell-h2" className="sell-h display"><span className="d-only">2. </span>Photos</h2>
                <span className="hint">0 / 20</span>
              </div>
              <div className="sell-photos">
                <button type="button" className="sell-add d-only" onClick={noPhotos} aria-describedby="sell-photo-hint"><Icon name="image" size={26} />Add photos</button>
                <Thumb listing={look} className="sell-photo" size={34}><span className="sell-cover">Placeholder</span></Thumb>
                <button type="button" className="sell-add m-only" onClick={noPhotos} aria-describedby="sell-photo-hint"><Icon name="camera" size={24} />Camera</button>
                <button type="button" className="sell-add m-only" onClick={noPhotos} aria-describedby="sell-photo-hint"><Icon name="image" size={24} />Gallery</button>
              </div>
              <p id="sell-photo-hint" className="hint">{photoHint}</p>
            </section>

            {/* 4. Format & price (phone step 2) */}
            <section id="sell-s4" aria-labelledby="sell-h4" className={cx('sell-sec o4', step !== 1 && 'off')} onFocusCapture={() => setActive(4)}>
              <h2 id="sell-h4" className="sell-h sell-h-sm"><span className="d-only">4. </span>How do you want to sell?</h2>
              <div role="radiogroup" aria-labelledby="sell-h4" className="sell-formats">
                {FORMATS.map((f) => (
                  <label key={f.id} className={cx('sell-fmt', d.format === f.id && 'on')}>
                    <input type="radio" name="format" value={f.id} className="sr" checked={d.format === f.id} onChange={() => set('format', f.id)} />
                    <Icon name={f.icon} size={24} width={1.8} className="d-only" />
                    <strong>{f.label}</strong>
                    <span className="m-only">{f.id === 'auction' ? `Bids for ${d.duration} days` : f.short}</span>
                    <span className="d-only">{f.hint}</span>
                  </label>
                ))}
              </div>

              {d.format === 'free' ? (
                <p className="sell-free">Free listings show a <strong>Free</strong> tag and appear in the Free stuff section.</p>
              ) : (
                <div className="sell-price-grid">
                  <div className="field sell-price-field">
                    <label htmlFor="sell-price">{PRICE_LABEL[d.format]}</label>
                    <div className={cx('sell-money', shown('price') && 'bad')}>
                      <span className="display" aria-hidden="true">₹</span>
                      <input id="sell-price" inputMode="numeric" autoComplete="off" placeholder="0" value={grouped(d.price)}
                        onChange={(e) => set('price', digits(e.target.value))} onBlur={() => touch('price')} {...aria('price')} />
                    </div>
                    {err('price')}
                    {range && range.cat === category && range.n > 0 && (
                      <span className="hint">Similar {category.toLowerCase()} near you are listed at {inr(range.lo)}{range.hi !== range.lo && `–${inr(range.hi)}`}.</span>
                    )}
                  </div>
                  {d.format === 'auction' && (
                    <>
                      <div className="field">
                        <label htmlFor="sell-buyNow">Buy Now <span className="sell-opt">(optional)</span></label>
                        <div className={cx('sell-money sm', shown('buyNow') && 'bad')}>
                          <span aria-hidden="true">₹</span>
                          <input id="sell-buyNow" inputMode="numeric" autoComplete="off" placeholder="No Buy Now" value={grouped(d.buyNow)}
                            onChange={(e) => set('buyNow', digits(e.target.value))} onBlur={() => touch('buyNow')} {...aria('buyNow')} />
                        </div>
                        {err('buyNow')}
                      </div>
                      <div className="field">
                        <label htmlFor="sell-dur">Runs for</label>
                        <select id="sell-dur" className="input sell-select" value={d.duration} onChange={(e) => set('duration', Number(e.target.value))}>
                          {DURATIONS.map((n) => <option key={n} value={n}>{n} days</option>)}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>

            {/* 3. Details (phone step 3) */}
            <section id="sell-s3" aria-labelledby="sell-h3" className={cx('sell-sec o3', step !== 2 && 'off')} onFocusCapture={() => setActive(3)}>
              <h2 id="sell-h3" className="sell-h display"><span className="d-only">3. </span>Details</h2>
              <fieldset className="sell-fieldset">
                <legend>Condition</legend>
                <div className="sell-conds">
                  {CONDITIONS.map((c) => (
                    <label key={c} className={cx('sell-cond', d.condition === c && 'on')}>
                      <input type="radio" name="condition" value={c} className="sr" checked={d.condition === c} onChange={() => set('condition', c)} />
                      {c}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="field">
                <label htmlFor="sell-desc">Description</label>
                <textarea id="sell-desc" className="input" rows={5} maxLength={4000} value={d.description}
                  placeholder="Model, size, age, any marks or repairs, what's included…" onChange={(e) => set('description', e.target.value)} />
                <span className="hint">Mention model, size and any marks. Buyers ask fewer questions.</span>
              </div>
            </section>

            {/* 5. Location (phone step 3) */}
            <section id="sell-s5" aria-labelledby="sell-h5" className={cx('sell-sec o5', step !== 2 && 'off')} onFocusCapture={() => setActive(5)}>
              <h2 id="sell-h5" className="d-only sell-h display">5. Location</h2>
              <div className="field">
                <label htmlFor="sell-location">Pick-up area</label>
                <input id="sell-location" className="input" value={d.location} maxLength={60} placeholder="e.g. Koramangala"
                  onChange={(e) => set('location', e.target.value)} onBlur={() => touch('location')} {...aria('location')} />
                {err('location') || <span className="hint">Buyers only see the area, never your address.</span>}
              </div>
            </section>

            {/* Phone step 4: review */}
            <section aria-labelledby="sell-h6" className={cx('sell-sec sell-review m-only', step !== 3 && 'off')}>
              <h2 id="sell-h6" className="sell-h display">Review &amp; post</h2>
              {preview}
              <dl className="sell-sum">
                {([
                  ['Title', d.title.trim() || '—', 0],
                  ['Category', category || '—', 0],
                  ['Format', FORMATS.find((f) => f.id === d.format)!.label + (d.format === 'auction' ? ` · ${d.duration} days` : ''), 1],
                  [d.format === 'free' ? 'Price' : PRICE_LABEL[d.format], d.format === 'free' ? 'Free' : priceNum ? inr(priceNum) : '—', 1],
                  ...(d.format === 'auction' && d.buyNow ? [['Buy Now', inr(Number(d.buyNow)), 1] as [string, string, number]] : []),
                  ['Condition', d.condition, 2],
                  ['Pick-up area', d.location.trim() || '—', 2],
                ] as [string, string, number][]).map(([k, v, s]) => (
                  <div key={k} className="sell-sum-row">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                    <button type="button" className="sell-link" onClick={() => goStep(s)} aria-label={`Edit ${k.toLowerCase()}`}>Edit</button>
                  </div>
                ))}
              </dl>
              {d.description.trim() && <p className="sell-sum-desc">{d.description.trim()}</p>}
              <p className="hint">By posting you agree to the Haat listing rules. Listing is free; a success fee applies only when it sells.</p>
            </section>

            {failure && <div role="alert" className="status-err sell-failure">{failure}</div>}

            {/* Desktop footer */}
            <div className="d-only sell-foot">
              <span className="hint">By listing you agree to the Haat listing rules. Success fee applies only when it sells.</span>
              <div className="sell-foot-actions">
                <button type="button" className="btn ghost round" onClick={saveDraft}>Save draft</button>
                <button type="submit" className="btn red round sell-publish" disabled={busy}>{busy ? 'Publishing…' : 'Publish listing'}</button>
              </div>
            </div>
          </form>

          {/* ---------- Desktop live preview ---------- */}
          <aside aria-label="Live preview" className="d-only sell-aside">
            <span className="sell-kicker">LIVE PREVIEW</span>
            {preview}
            <div className="sell-tips">
              <strong>Tips to sell faster</strong>
              <ul>
                <li>Use daylight photos. The first one is your cover.</li>
                <li>Mention model, size and any marks.</li>
                <li>Reply quickly. Buyers see your response time.</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>

      {/* ---------- Phone bottom bar ---------- */}
      <div className="m-only sell-bar">
        <button type="button" className="btn ghost" onClick={back}>Back</button>
        <button type="button" className="btn red" onClick={next} disabled={busy}>{busy ? 'Posting…' : NEXT_LABEL[step]}</button>
      </div>

      {picking && (
        <Sheet title="Choose a category" onClose={() => setPicking(false)}>
          <div className="sell-cats" role="radiogroup" aria-label="Category">
            {CATEGORIES.map((c) => {
              const lk = CATEGORY_LOOK[c]
              return (
                <button key={c} type="button" role="radio" aria-checked={category === c} className={cx('sell-catopt', category === c && 'on')}
                  onClick={() => { setD((p) => ({ ...p, category: c, picked: true })); setPicking(false); requestAnimationFrame(() => document.getElementById('sell-cat-btn')?.focus()) }}>
                  <span className="sell-catopt-icon" style={{ background: lk.tone }}><Icon name={lk.icon} size={24} stroke={lk.ink} width={1.6} /></span>
                  {c}
                </button>
              )
            })}
          </div>
        </Sheet>
      )}

      {toast && <Toast>{toast}</Toast>}
    </div>
  )
}
