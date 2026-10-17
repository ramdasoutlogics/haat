import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Listing } from '../api'
import { goSignIn, useAuth } from '../auth'
import { Icon, type IconName } from '../icons'
import { ago, badgeFor, cx, priceOf, thumbFor, timeLeft } from '../lib'
import { useNow } from '../ssr'

export function Thumb({ listing, size = 46, className, children }: {
  listing: Pick<Listing, 'title' | 'category'>
  size?: number
  className?: string
  children?: React.ReactNode
}) {
  const t = thumbFor(listing)
  return (
    <span className={cx('thumb', className)} style={{ background: t.tone }}>
      <Icon name={t.icon} size={size} stroke={t.ink} width={1.3} />
      {children}
    </span>
  )
}

export function Badge({ kind, children, big }: { kind: 'buy' | 'auc' | 'neg' | 'feat'; children: React.ReactNode; big?: boolean }) {
  return <span className={cx('badge', kind, big && 'big')}>{children}</span>
}

export function FormatBadge({ listing, big }: { listing: Listing; big?: boolean }) {
  const b = badgeFor(listing)
  return <Badge kind={b.kind} big={big}>{b.label}</Badge>
}

export function Avatar({ initials, size = 48, tone = '#E5ECF4', ink = '#2E4E74' }: { initials: string; size?: number; tone?: string; ink?: string }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: tone, color: ink, fontSize: size * 0.36 }}>
      {initials}
    </span>
  )
}

export function VerifiedMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#1E5B43" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Verified">
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  )
}

/** Heart toggle that saves to the watchlist. Optimistic, rolls back on error. */
export function WatchButton({ listing, className, size = 17, onChange }: {
  listing: Pick<Listing, 'id' | 'watched' | 'mine'>
  className?: string
  size?: number
  onChange?: (watched: boolean) => void
}) {
  const [on, setOn] = useState(listing.watched)
  const { user } = useAuth()
  useEffect(() => setOn(listing.watched), [listing.watched])
  if (listing.mine) return null
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!user) return goSignIn()
    const next = !on
    setOn(next)
    try {
      const r = await api.toggleWatch(listing.id)
      setOn(r.watched)
      onChange?.(r.watched)
    } catch {
      setOn(!next)
    }
  }
  return (
    <button type="button" className={cx('watch', className)} aria-label={on ? 'Remove from watchlist' : 'Add to watchlist'} aria-pressed={on} onClick={toggle}>
      <span className="watch-dot">
        <Icon name="heart" size={size} fill={on ? '#C43D19' : 'none'} stroke={on ? '#C43D19' : '#16211C'} />
      </span>
    </button>
  )
}

/** Grid card used on Home (mobile 2-up, desktop 4-up). */
export function ListingCard({ listing }: { listing: Listing }) {
  const now = useNow()
  const meta = listing.format === 'auction' ? `${listing.bids_count} bids` : ago(listing.created_at, now)
  return (
    <article className="lcard card-hover">
      <Link to={`/listing/${listing.id}`} className="lcard-link">
        <Thumb listing={listing} className="lcard-img" size={46}>
          {listing.featured && <Badge kind="feat">FEATURED</Badge>}
        </Thumb>
        <span className="lcard-body">
          <span className="lcard-price">
            <strong className="display">{priceOf(listing)}</strong>
            <span className="d-only"><FormatBadge listing={listing} /></span>
          </span>
          <span className="lcard-title">{listing.title}</span>
          <span className="lcard-meta">
            <Icon name="pin" size={13} className="d-only" />
            {listing.location} · {meta}
          </span>
        </span>
      </Link>
      <WatchButton listing={listing} />
    </article>
  )
}

/** Horizontal row card (search results, account lists). */
export function ListingRow({ listing, meta, right, to }: {
  listing: Listing
  meta?: React.ReactNode
  right?: React.ReactNode
  to?: string
}) {
  const now = useNow()
  const b = badgeFor(listing)
  return (
    <Link to={to ?? `/listing/${listing.id}`} className="lrow card-hover">
      <Thumb listing={listing} className="lrow-img" size={38}>
        {listing.featured && <Badge kind="feat">FEATURED</Badge>}
      </Thumb>
      <span className="lrow-body">
        <span className="lrow-title">{listing.title}</span>
        <span className="lrow-price">
          <strong className="display">{priceOf(listing)}</strong>
          <Badge kind={b.kind}>{listing.format === 'auction' ? `CLOSES ${timeLeft(listing.closes_at, now).toUpperCase()}` : b.label}</Badge>
        </span>
        <span className="lrow-meta">{meta ?? `${listing.location} · ${listing.distance_km} km · ${ago(listing.created_at, now)}`}</span>
      </span>
      {right}
    </Link>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label, pill }: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
  label: string
  pill?: boolean
}) {
  return (
    <div role="tablist" aria-label={label} className={cx('seg', pill && 'pill')}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="tab" aria-selected={v === value} className={cx('seg-btn', v === value && 'on')} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

export function Chip({ on, children, onClick }: { on?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className={cx('chip', on && 'on')} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

export function IconButton({ icon, label, onClick, className, size = 20, children }: {
  icon: IconName
  label: string
  onClick?: () => void
  className?: string
  size?: number
  children?: React.ReactNode
}) {
  return (
    <button type="button" className={cx('icon-btn', className)} aria-label={label} onClick={onClick}>
      <Icon name={icon} size={size} />
      {children}
    </button>
  )
}

/** Bottom sheet on phones, centered dialog on desktop. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="sheet-wrap">
      <button type="button" className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="sheet">
        <span className="sheet-grip m-only" />
        <div className="sheet-head">
          <strong className="display">{title}</strong>
          <IconButton icon="close" label="Close" className="round soft" onClick={onClose} size={18} />
        </div>
        {children}
      </div>
    </div>
  )
}

export function Stepper({ value, onChange, step = 500, min = 500, format }: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  format: (n: number) => string
}) {
  return (
    <div className="stepper">
      <button type="button" aria-label="Decrease" onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <strong className="display">{format(value)}</strong>
      <button type="button" aria-label="Increase" onClick={() => onChange(value + step)}>+</button>
    </div>
  )
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeletons" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton" />)}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="error-box">
      <span>{message}</span>
      {onRetry && <button type="button" className="btn ghost sm" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={26} stroke="#1E5B43" /></span>
      <strong>{title}</strong>
      {children}
    </div>
  )
}

export function Toast({ children }: { children: React.ReactNode }) {
  return <div role="status" className="toast">{children}</div>
}
