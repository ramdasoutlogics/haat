import type { Format, Listing } from './api'
import type { IconName } from './icons'

export const inr = (n: number) => '₹' + n.toLocaleString('en-IN')

type Priced = Pick<Listing, 'format' | 'price' | 'current_bid'>

export function priceOf(l: Priced): string {
  if (l.format === 'free') return 'Free'
  if (l.format === 'auction') return inr(l.current_bid ?? l.price)
  return inr(l.price)
}

export function timeLeft(iso: string | null, now: number): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return 'Closed'
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  return `${h}h ${m % 60}m`
}

/** "3h 12m" → "3H 12M" style is used on badges; this returns the short hour form ("3h"). */
export function hoursLeft(iso: string | null, now: number): string {
  const t = timeLeft(iso, now)
  return t.split(' ')[0]
}

export function ago(iso: string | null, now: number, long = false): string {
  if (!iso) return ''
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return long ? `${m} min ago` : `${m}m`
  if (m < 1440) return long ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 60)}h`
  if (m < 2880) return 'Yesterday'
  return long ? `${Math.floor(m / 1440)} days ago` : `${Math.floor(m / 1440)}d`
}

export function closesAt(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}

export const FORMAT_LABEL: Record<Format, string> = {
  fixed: 'Buy Now',
  auction: 'Auction',
  offer: 'Make an offer',
  free: 'Free',
}

/** Badge kind: buy (green), auc (red), neg (blue). */
export function badgeFor(l: Pick<Listing, 'format' | 'bids_count'>): { label: string; kind: 'buy' | 'auc' | 'neg' } {
  switch (l.format) {
    case 'auction':
      return { label: `${l.bids_count} BIDS`, kind: 'auc' }
    case 'offer':
      return { label: 'OFFERS', kind: 'neg' }
    case 'free':
      return { label: 'FREE', kind: 'buy' }
    default:
      return { label: 'BUY NOW', kind: 'buy' }
  }
}

export const CATEGORY_LOOK: Record<string, { icon: IconName; tone: string; ink: string }> = {
  Cars: { icon: 'car', tone: '#E5ECF4', ink: '#3B5E86' },
  Property: { icon: 'home', tone: '#E6EFE9', ink: '#2F6A52' },
  Mobiles: { icon: 'phone', tone: '#EDE6F2', ink: '#6A4F86' },
  Tech: { icon: 'laptop', tone: '#F5EED6', ink: '#7A6420' },
  Home: { icon: 'sofa', tone: '#F7E7DC', ink: '#9A4A2B' },
  Fashion: { icon: 'shirt', tone: '#EDE6F2', ink: '#6A4F86' },
  Bikes: { icon: 'bike', tone: '#E9EEE3', ink: '#56703A' },
  Pets: { icon: 'paw', tone: '#F7E7DC', ink: '#9A4A2B' },
}
export const CATEGORIES = Object.keys(CATEGORY_LOOK)

const KEYWORDS: [RegExp, IconName][] = [
  [/camera/i, 'camera'],
  [/macbook|laptop/i, 'laptop'],
  [/iphone|phone|pixel|galaxy/i, 'phone'],
  [/cycle|scooter|bike/i, 'bike'],
  [/table|dining|chair|sofa|sheesham/i, 'sofa'],
]

/** Placeholder photo look for a listing until real images are uploaded. */
export function thumbFor(l: Pick<Listing, 'title' | 'category'>) {
  const base = CATEGORY_LOOK[l.category] ?? CATEGORY_LOOK.Tech
  const hit = KEYWORDS.find(([re]) => re.test(l.title))
  return { ...base, icon: hit ? hit[1] : base.icon }
}

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')
