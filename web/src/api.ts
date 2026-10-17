export type Format = 'fixed' | 'auction' | 'offer' | 'free'

export interface User {
  id: number
  name: string
  initials: string
  city: string
  member_since: number
  verified: boolean
  positive: number
  ratings: number
  reply_time: string | null
  avatar_url?: string | null
}

/** Who is signed in (from the session cookie). */
export interface SessionUser {
  id: number
  name: string
  initials: string
  avatar_url: string | null
}

export interface Listing {
  id: number
  seller_id: number
  title: string
  category: string
  format: Format
  price: number
  buy_now: number | null
  current_bid: number | null
  bids_count: number
  closes_at: string | null
  location: string
  distance_km: number
  condition: string
  featured: boolean
  views: number
  status: string
  created_at: string
  watched: boolean
  mine: boolean
  // detail only
  specs?: { k: string; v: string }[]
  description?: string
  seller?: User
  watchers?: number
  chats?: number
  you_lead?: boolean
  min_bid?: number | null
  purchase_status?: string
  seller_name?: string
}

export interface Message {
  id: number
  mine: boolean
  kind: 'text' | 'offer'
  body: string
  amount: number | null
  offer_status: 'pending' | 'accepted' | 'declined' | 'countered' | null
  created_at: string
}

export interface ChatSummary {
  id: number
  role: 'buying' | 'selling'
  other: Pick<User, 'id' | 'name' | 'initials' | 'verified' | 'positive' | 'ratings' | 'reply_time'>
  listing: Pick<Listing, 'id' | 'title' | 'category' | 'format' | 'price' | 'buy_now' | 'current_bid'>
  last: string
  last_at: string | null
  unread: number
}

export interface Chat extends ChatSummary {
  messages: Message[]
}

export interface Me {
  user: User
  earned: number
  listings: Listing[]
  watching: Listing[]
  bought: Listing[]
  unread_chats: number
  unread_notifications: number
}

export interface Notification {
  id: number
  text: string
  listing_id: number | null
  read: boolean
  created_at: string
}

export interface Page<T> {
  total: number
  items: T[]
}

export interface SearchParams {
  q?: string
  category?: string
  formats?: Format[]
  verified?: boolean
  max_km?: number
  min_price?: number
  max_price?: number
  sort?: string
  limit?: number
  offset?: number
}

// In the browser calls go to /api on the same host; during server rendering they go straight to the API.
let base = ''
export const setApiBase = (url: string) => {
  base = url.replace(/\/$/, '')
}
// During server rendering, the visitor's cookie is passed on so the API knows who is signed in.
let extraHeaders: () => Record<string, string> = () => ({})
export const setRequestHeaders = (fn: () => Record<string, string>) => {
  extraHeaders = fn
}

/** Google sign-in, then back to `next` (the current page by default). */
export const signInUrl = (next?: string) => {
  const here = next ?? (typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search)
  return `/api/auth/google/login?next=${encodeURIComponent(here)}`
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...extraHeaders(), ...(init?.headers ?? {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Signed out (or the session ended) while doing something: sign in, then come back here.
    if (res.status === 401 && init?.method === 'POST' && typeof window !== 'undefined') window.location.assign(signInUrl())
    const detail = data?.detail
    throw new ApiError(typeof detail === 'string' ? detail : 'Something went wrong. Please try again.', res.status)
  }
  return data as T
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  categories: () => req<{ name: string; count: number }[]>('/categories'),
  listings: (p: SearchParams = {}) => {
    const qs = new URLSearchParams()
    if (p.q) qs.set('q', p.q)
    if (p.category) qs.set('category', p.category)
    if (p.formats?.length) qs.set('formats', p.formats.join(','))
    if (p.verified) qs.set('verified', 'true')
    if (p.max_km) qs.set('max_km', String(p.max_km))
    if (p.min_price) qs.set('min_price', String(p.min_price))
    if (p.max_price) qs.set('max_price', String(p.max_price))
    if (p.sort) qs.set('sort', p.sort)
    if (p.limit) qs.set('limit', String(p.limit))
    if (p.offset) qs.set('offset', String(p.offset))
    return req<Page<Listing>>(`/listings?${qs}`)
  },
  listing: (id: number) => req<Listing>(`/listings/${id}`),
  createListing: (body: {
    title: string
    category: string
    format: Format
    price: number
    buy_now?: number | null
    condition: string
    description: string
    duration_days?: number
    location?: string
  }) => post<Listing>('/listings', body),
  toggleWatch: (id: number) => post<{ watched: boolean }>(`/listings/${id}/watch`),
  bid: (id: number, amount: number) => post<Listing>(`/listings/${id}/bids`, { amount }),
  offer: (id: number, amount: number) => post<{ chat_id: number }>(`/listings/${id}/offers`, { amount }),
  openChat: (id: number) => post<{ chat_id: number }>(`/listings/${id}/chat`),
  chats: () => req<ChatSummary[]>('/chats'),
  chat: (id: number) => req<Chat>(`/chats/${id}`),
  send: (id: number, body: string) => post<Chat>(`/chats/${id}/messages`, { body }),
  respond: (messageId: number, action: 'accept' | 'decline' | 'counter', amount?: number) =>
    post<Chat>(`/messages/${messageId}/respond`, { action, amount }),
  session: () => req<{ user: SessionUser | null; google: boolean }>('/auth/session'),
  logout: () => post<{ ok: boolean }>('/auth/logout'),
  me: () => req<Me>('/me'),
  notifications: () => req<Notification[]>('/notifications'),
}
