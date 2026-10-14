import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Listing, type Page } from '../api'
import { Badge, ErrorBox, ListingCard, Loading, Thumb } from '../components/ui'
import { Icon, type IconName } from '../icons'
import { CATEGORY_LOOK, cx, inr, timeLeft } from '../lib'
import { usePageData, useNow } from '../ssr'

interface HomeData {
  best: Page<Listing>
  nearest: Page<Listing>
  newest: Page<Listing>
  auctions: Page<Listing>
}

export async function load(): Promise<HomeData> {
  const [best, nearest, newest, auctions] = await Promise.all([
    api.listings({ sort: 'best', limit: 8 }),
    api.listings({ sort: 'nearest', limit: 8 }),
    api.listings({ sort: 'newest', limit: 8 }),
    api.listings({ formats: ['auction'], limit: 8 }),
  ])
  return { best, nearest, newest, auctions }
}

const VERTICALS = ['Marketplace', 'Cars & Bikes', 'Property', 'Mobiles', 'Tech']
const VERTICAL_LINK: Record<string, string> = {
  Marketplace: '/search',
  'Cars & Bikes': '/search?category=Cars',
  Property: '/search?category=Property',
  Mobiles: '/search?category=Mobiles',
  Tech: '/search?category=Tech',
}
const QUICK: [string, string][] = [
  ['Free stuff', '/search?formats=free'],
  ['Closing soon', '/search?formats=auction'],
  ['Phones', '/search?category=Mobiles'],
  ['Bikes & cycles', '/search?category=Bikes'],
  ['Flats for rent', '/search?category=Property'],
]
const SECTIONS: { name: string; line: string; cta: string; icon: IconName; to: string; cls: string }[] = [
  { name: 'Cars & Bikes', line: 'Cars, motorbikes and scooters from dealers and owners.', cta: 'Find a vehicle', icon: 'car', to: '/search?category=Cars', cls: 'v-green' },
  { name: 'Property', line: 'Flats, PGs and plots to buy or rent across India.', cta: 'Find a place', icon: 'home', to: '/search?category=Property', cls: 'v-blue' },
  { name: 'Mobiles & Tech', line: 'Phones, laptops and cameras, many with bills and warranty.', cta: 'Browse gadgets', icon: 'phone', to: '/search?category=Mobiles', cls: 'v-cream' },
  { name: 'Free stuff', line: 'Things neighbours are giving away. Just pick them up.', cta: 'See free items', icon: 'gift', to: '/search?formats=free', cls: 'v-dark' },
]
const TRUST: { icon: IconName; title: string; body: string }[] = [
  { icon: 'verified', title: 'Verified sellers', body: 'Phone and KYC checks show a badge on every profile.' },
  { icon: 'chat', title: 'Chat in the app', body: 'Keep your number private and every message on record.' },
  { icon: 'shield', title: 'Buyer protection', body: "Pay by UPI with Haat Pay and get covered if it doesn't arrive." },
  { icon: 'star', title: 'Ratings that count', body: 'Only people who traded together can leave feedback.' },
]
const STEPS = [
  ['Snap and describe', 'Add up to 20 photos and we suggest a category.'],
  ['Choose how to sell', 'Fixed price, auction, make an offer or give it away.'],
  ['Chat, agree, done', 'Meet up, ship it, or get paid in the app.'],
]

export default function Home() {
  const { data, error, reload } = usePageData(load)
  const [vertical, setVertical] = useState(0)
  const [feed, setFeed] = useState<'best' | 'nearest' | 'newest'>('best')
  const now = useNow()
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  const auctions = data ? [...data.auctions.items].sort((a, b) => (a.closes_at ?? '').localeCompare(b.closes_at ?? '')) : []
  const soonest = auctions[0]

  return (
    <div className="home">
      {/* ---------- Phone: green header ---------- */}
      <div className="m-only home-top">
        <div className="home-top-row">
          <button type="button" className="home-loc">
            <Icon name="pin" size={20} stroke="#F4C430" />
            Koramangala, Bengaluru
            <Icon name="down" size={16} stroke="#fff" width={2.2} />
          </button>
          <Link to="/account" className="home-bell" aria-label="Notifications">
            <Icon name="bell" size={22} stroke="#fff" width={1.8} />
            <span className="dot" />
          </Link>
        </div>
        <Link to="/search" className="home-search">
          <Icon name="search" size={20} />
          Search cars, phones, flats…
        </Link>
        <div className="chips home-verticals">
          {VERTICALS.map((v, i) => (
            <Link key={v} to={VERTICAL_LINK[v]} className={cx('vchip', i === vertical && 'on')} onClick={() => setVertical(i)}>{v}</Link>
          ))}
        </div>
      </div>

      {/* ---------- Desktop: hero ---------- */}
      <section className="d-only hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <span className="hero-kicker">India's local marketplace</span>
            <h1 className="display">Buy and sell with people near you.</h1>
            <p>Fixed price, auction or make an offer. Chat with sellers in the app and pay safely by UPI with buyer protection.</p>
            <form className="hero-search" role="search" onSubmit={(e) => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(q.trim())}`) }}>
              <label htmlFor="hero-q" className="sr">What are you looking for?</label>
              <input id="hero-q" type="search" placeholder="What are you looking for?" value={q} onChange={(e) => setQ(e.target.value)} />
              <label htmlFor="hero-where" className="sr">Where</label>
              <select id="hero-where" defaultValue="blr">
                <option value="blr">Bengaluru · 25 km</option>
                <option value="in">All of India</option>
              </select>
              <button type="submit" className="btn red">Search</button>
            </form>
            <div className="hero-quick">
              {QUICK.map(([label, to]) => <Link key={label} to={to}>{label}</Link>)}
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-card one">
              <span className="hero-card-img" style={{ background: '#E5ECF4' }}><Icon name="bike" size={70} stroke="#3B5E86" width={1.2} /></span>
              <span className="hero-card-body"><strong className="display">₹8,500</strong><span>Hercules geared cycle, 21-speed</span><span className="muted">Koramangala · 2h ago</span></span>
            </div>
            <div className="hero-card two">
              <span className="hero-card-img" style={{ background: '#F7E7DC' }}><Icon name="sofa" size={64} stroke="#9A4A2B" width={1.2} /></span>
              <span className="hero-card-body">
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><strong className="display">{soonest ? inr(soonest.current_bid ?? soonest.price) : '₹14,500'}</strong><Badge kind="auc">AUCTION</Badge></span>
                <span>{soonest?.title ?? 'Sheesham dining set'}</span>
                <span className="muted">Closes in {soonest ? timeLeft(soonest.closes_at, now) : '3h 12m'}</span>
              </span>
            </div>
            <div className="hero-toast">
              <span className="hero-toast-icon"><Icon name="check" size={18} stroke="#fff" width={2.4} /></span>
              <span><strong>Offer accepted · ₹8,000</strong><span className="muted">Pick up Saturday, Koramangala</span></span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Categories ---------- */}
      <section aria-labelledby="cat-h" className="home-section wrap">
        <div className="sec-head d-flex d-only">
          <h2 id="cat-h" className="display">Browse categories</h2>
          <Link to="/search">All categories</Link>
        </div>
        <h2 className="sr m-only">Categories</h2>
        <div className="cats">
          {Object.entries(CATEGORY_LOOK).map(([name, c]) => (
            <Link key={name} to={`/search?category=${name}`} className="cat card-hover">
              <span className="cat-icon" style={{ background: c.tone }}><Icon name={c.icon} size={26} stroke={c.ink} width={1.6} /></span>
              <span className="cat-name">{name}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- Phone: auctions banner ---------- */}
      <Link to="/search?formats=auction" className="m-only home-banner">
        <span>
          <strong className="display">Auctions closing soon</strong>
          <span>{soonest ? `Next one ends in ${timeLeft(soonest.closes_at, now)} · ${data?.auctions.total} live` : 'Bid before they close'}</span>
        </span>
        <span className="home-banner-go"><Icon name="right" size={18} stroke="#fff" width={2.4} /></span>
      </Link>

      {error && <ErrorBox message={error} onRetry={reload} />}

      {/* ---------- Fresh near you ---------- */}
      <section aria-labelledby="fresh-h" className="home-section wrap">
        <div className="sec-head">
          <div className="sec-title">
            <h2 id="fresh-h" className="display"><span className="m-only">Fresh near you</span><span className="d-only">Fresh near you in Bengaluru</span></h2>
            <span className="d-only muted">Within 25 km · updated every few minutes</span>
          </div>
          <Link to="/search" className="m-only see-all">See all</Link>
          <div role="tablist" aria-label="Listing feed" className="d-only feed-tabs">
            {([['best', 'For you'], ['nearest', 'Nearest'], ['newest', 'Newest']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={feed === k} className={cx(feed === k && 'on')} onClick={() => setFeed(k)}>{label}</button>
            ))}
          </div>
        </div>
        {!data && !error ? <Loading rows={2} /> : data && (
          <div className="grid-cards">
            {data[feed].items.map((l, i) => (
              <div key={l.id} className={cx(i >= 4 && 'd-only')}><ListingCard listing={l} /></div>
            ))}
          </div>
        )}
        <div className="d-flex d-only center-row">
          <Link to="/search" className="btn ghost round">Show more near you</Link>
        </div>
      </section>

      {/* ---------- Desktop: auctions closing soon ---------- */}
      {auctions.length > 0 && (
        <section aria-labelledby="close-h" className="d-only home-section wrap">
          <div className="sec-head">
            <div className="sec-title row">
              <span className="sec-icon"><Icon name="clock" size={22} stroke="#A3361A" /></span>
              <h2 id="close-h" className="display">Auctions closing soon</h2>
            </div>
            <Link to="/search?formats=auction">See all auctions</Link>
          </div>
          <div className="auction-grid">
            {auctions.slice(0, 4).map((a) => (
              <Link key={a.id} to={`/listing/${a.id}`} className="auction card-hover">
                <Thumb listing={a} size={40} className="auction-img" />
                <span className="auction-body">
                  <span className="auction-title">{a.title}</span>
                  <span className="muted">Current bid · {a.bids_count} bids</span>
                  <strong className="display">{inr(a.current_bid ?? a.price)}</strong>
                  <span className="auction-left">Closes in {timeLeft(a.closes_at, now)}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ---------- Desktop: sections, trust, sell CTA ---------- */}
      <section aria-label="Marketplace sections" className="d-only home-section wrap">
        <div className="verticals">
          {SECTIONS.map((v) => (
            <Link key={v.name} to={v.to} className={cx('vcard card-hover', v.cls)}>
              <Icon name={v.icon} size={34} width={1.6} />
              <span className="vcard-name display">{v.name}</span>
              <span className="vcard-line">{v.line}</span>
              <span className="vcard-cta">{v.cta} <Icon name="right" size={16} width={2.4} /></span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="trust-h" className="d-only home-section wrap">
        <h2 id="trust-h" className="display sec-h">Trade with confidence</h2>
        <div className="trust">
          {TRUST.map((t) => (
            <div key={t.title} className="trust-item">
              <span className="trust-icon"><Icon name={t.icon} size={22} stroke="#1E5B43" width={1.8} /></span>
              <strong>{t.title}</strong>
              <span className="muted">{t.body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="d-only home-section wrap last">
        <div className="sell-cta">
          <div className="sell-cta-copy">
            <h2 className="display">Got something to sell? List it free in two minutes.</h2>
            <p>Snap a few photos, set a price or start an auction, and let buyers nearby message you.</p>
            <div className="sell-cta-actions">
              <Link to="/sell" className="btn red round">Start selling</Link>
              <Link to="/search" className="btn round outline-light">Browse first</Link>
            </div>
          </div>
          <ol className="steps">
            {STEPS.map(([title, body], i) => (
              <li key={title}>
                <span className="step-n display">{i + 1}</span>
                <span><strong>{title}</strong><span>{body}</span></span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  )
}
