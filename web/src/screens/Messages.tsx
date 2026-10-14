import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Chat, type ChatSummary, type Message } from '../api'
import { Empty, ErrorBox, Sheet, Stepper, Thumb, Toast, VerifiedMark } from '../components/ui'
import { Icon } from '../icons'
import { ago, cx, inr } from '../lib'
import { usePageData, useNow, type LoadArgs } from '../ssr'

interface MsgData {
  chats: ChatSummary[]
  chat: Chat | null
  chatId: number | null
  chatError: string | null
}

export async function load({ params }: Pick<LoadArgs, 'params'>): Promise<MsgData> {
  const chatId = params.id ? Number(params.id) : null
  const [chats, res] = await Promise.all([
    api.chats(),
    chatId
      ? api.chat(chatId).then((chat) => ({ chat, chatError: null }), (e: Error) => ({ chat: null, chatError: e.message }))
      : Promise.resolve({ chat: null, chatError: null }),
  ])
  return { chats, chatId, ...res }
}

export function title(d: MsgData | null) {
  return d?.chat ? `Chat with ${d.chat.other.name}` : 'Messages'
}

type Tab = 'all' | 'buying' | 'selling'
const TABS: [Tab, string][] = [['all', 'All'], ['buying', 'Buying'], ['selling', 'Selling']]
const QUICK: Record<ChatSummary['role'], string[]> = {
  selling: ['Saturday 10am?', "Here's the address", 'Still available'],
  buying: ['Is it still available?', 'Saturday pick up works', 'Can you post it?'],
}

interface Pending { key: number; chatId: number; body: string; failed?: boolean }

const firstName = (name: string) => name.split(' ')[0]

/** "Buy Now ₹38,000 · bid ₹31,500" (phone strip). */
function priceLine(l: ChatSummary['listing']) {
  if (l.format === 'free') return 'Free'
  if (l.format === 'offer') return `Asking ${inr(l.price)} · open to offers`
  if (l.format === 'auction') {
    const bid = l.current_bid ? `bid ${inr(l.current_bid)}` : `starts ${inr(l.price)}`
    return l.buy_now ? `Buy Now ${inr(l.buy_now)} · ${bid}` : `Auction · ${bid}`
  }
  return `Buy Now ${inr(l.price)}`
}

/** "Your listing · Current bid ₹31,500 · Buy Now ₹38,000" (desktop strip). */
function priceLineLong(c: ChatSummary) {
  const l = c.listing
  const parts = [c.role === 'selling' ? 'Your listing' : 'Seller’s listing']
  if (l.format === 'free') parts.push('Free')
  else if (l.format === 'offer') parts.push(`Asking ${inr(l.price)}`, 'Open to offers')
  else if (l.format === 'auction') {
    parts.push(l.current_bid ? `Current bid ${inr(l.current_bid)}` : `Starting bid ${inr(l.price)}`)
    if (l.buy_now) parts.push(`Buy Now ${inr(l.buy_now)}`)
  } else parts.push(`Buy Now ${inr(l.price)}`)
  return parts.join(' · ')
}

const IST = 'Asia/Kolkata'
const dayKey = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: IST })
function dayLabel(iso: string, now: number) {
  const t = new Date(iso).getTime()
  const k = dayKey(t)
  if (k === dayKey(now)) return 'Today'
  if (k === dayKey(now - 86400000)) return 'Yesterday'
  return new Date(t).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: IST })
}

export default function Messages() {
  const { data, setData, error, reload } = usePageData(load)
  const { id } = useParams()
  const openId = id ? Number(id) : null
  const now = useNow()
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [outbox, setOutbox] = useState<Pending[]>([])
  const [toast, setToast] = useState<string | null>(null)
  // Bumped by every mutation so a poll that started earlier can't overwrite newer state.
  const version = useRef(0)

  const chat = data?.chat && data.chat.id === openId ? data.chat : null
  const chatError = data && data.chatId === openId ? data.chatError : null
  const summary = data?.chats.find((c) => c.id === openId) ?? null

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const headName = (chat ?? summary)?.other.name
  useEffect(() => {
    document.title = `${headName ? `Chat with ${headName}` : 'Messages'} · Haat`
  }, [headName])

  const refreshList = useCallback(() => {
    const v = version.current
    api.chats().then((chats) => v === version.current && setData((d) => d && { ...d, chats })).catch(() => {})
  }, [setData])

  // Poll every 5s while the tab is visible so replies and new chats show up.
  useEffect(() => {
    let live = true
    const tick = async () => {
      if (document.visibilityState !== 'visible') return
      const v = version.current
      try {
        const [chats, fresh] = await Promise.all([api.chats(), openId ? api.chat(openId) : Promise.resolve(null)])
        if (!live || v !== version.current) return
        setData((d) => {
          if (!d) return d
          const next = { ...d, chats }
          return fresh && d.chatId === fresh.id ? { ...next, chat: fresh, chatError: null } : next
        })
      } catch { /* keep what we have; next tick retries */ }
    }
    const t = setInterval(tick, 5000)
    const onVis = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      live = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [openId, setData])

  const applyChat = (c: Chat) => setData((d) => (d && d.chatId === c.id ? { ...d, chat: c, chatError: null } : d))

  const send = async (chatId: number, body: string, key = Date.now() + Math.random()) => {
    version.current++
    setOutbox((o) => [...o.filter((p) => p.key !== key), { key, chatId, body }])
    // Optimistically bump the chat to the top of the list.
    setData((d) => {
      if (!d) return d
      const row = d.chats.find((c) => c.id === chatId)
      if (!row) return d
      const moved = { ...row, last: `You: ${body}`, last_at: new Date().toISOString() }
      return { ...d, chats: [moved, ...d.chats.filter((c) => c.id !== chatId)] }
    })
    try {
      const c = await api.send(chatId, body)
      version.current++
      applyChat(c)
      setOutbox((o) => o.filter((p) => p.key !== key))
      refreshList()
    } catch {
      setOutbox((o) => o.map((p) => (p.key === key ? { ...p, failed: true } : p)))
    }
  }

  const respond = async (m: Message, action: 'accept' | 'decline' | 'counter', amount?: number) => {
    if (!chat) return
    version.current++
    const before = chat
    const status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'countered'
    const messages = chat.messages.map((x) => (x.id === m.id ? { ...x, offer_status: status } as Message : x))
    if (action === 'counter' && amount) {
      messages.push({ id: -Date.now(), mine: true, kind: 'offer', body: 'Counter-offer', amount, offer_status: 'pending', created_at: new Date().toISOString() })
    }
    applyChat({ ...chat, messages })
    try {
      const c = await api.respond(m.id, action, amount)
      version.current++
      applyChat(c)
      refreshList()
      setToast(action === 'accept' ? 'Offer accepted' : action === 'decline' ? 'Offer declined' : `Counter-offer sent · ${inr(amount ?? 0)}`)
    } catch (e) {
      version.current++
      applyChat(before)
      setToast((e as Error).message)
    }
  }

  const list = data?.chats ?? []
  const counts = { all: list.length, buying: list.filter((c) => c.role === 'buying').length, selling: list.filter((c) => c.role === 'selling').length }
  const needle = q.trim().toLowerCase()
  const shown = list.filter((c) =>
    (tab === 'all' || c.role === tab) &&
    (!needle || c.other.name.toLowerCase().includes(needle) || c.listing.title.toLowerCase().includes(needle)))

  return (
    <div className={cx('msg', openId != null && 'is-open')}>
      <div className="msg-grid">
        {/* ---------- Inbox ---------- */}
        <section className="msg-list" aria-labelledby="msg-h">
          <div className="msg-list-head">
            <h1 id="msg-h" className="display"><span className="m-only">Chats</span><span className="d-only">Messages</span></h1>
            <div role="tablist" aria-label="Filter chats" className="msg-tabs">
              {TABS.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={cx(tab === k && 'on')} onClick={() => setTab(k)}>
                  {label}
                  {data && k !== 'all' && counts[k] > 0 && <span className="msg-tab-n">{counts[k]}</span>}
                </button>
              ))}
            </div>
            <label className="msg-search d-only">
              <Icon name="search" size={18} stroke="#5B665F" />
              <span className="sr">Search chats</span>
              <input type="search" placeholder="Search by name or item" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          </div>
          {!data && error ? (
            <ErrorBox message={error} onRetry={reload} />
          ) : !data ? (
            <div className="msg-rows" aria-busy="true" aria-label="Loading chats">
              {Array.from({ length: 6 }, (_, i) => <span key={i} className="msg-row-skel"><span className="skeleton" /><span><span className="skeleton" /><span className="skeleton" /></span></span>)}
            </div>
          ) : shown.length === 0 ? (
            <Empty icon="chat" title={list.length === 0 ? 'No chats yet' : needle ? 'No matching chats' : `No ${tab} chats`}>
              <span>{list.length === 0 ? 'Message a seller from any listing and the conversation shows up here.' : 'Try another filter.'}</span>
              {list.length === 0 && <Link to="/search" className="btn ghost sm round">Browse listings</Link>}
            </Empty>
          ) : (
            <ul className="msg-rows">
              {shown.map((c) => (
                <li key={c.id}><ChatRow c={c} active={c.id === openId} unread={c.id === openId ? 0 : c.unread} now={now} /></li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------- Conversation ---------- */}
        {openId ? (
          <Thread
            key={openId}
            chatId={openId}
            chat={chat}
            summary={summary}
            error={chatError ?? (!data ? error : null)}
            onRetry={reload}
            pending={outbox.filter((p) => p.chatId === openId)}
            now={now}
            onSend={(body) => send(openId, body)}
            onRetrySend={(p) => send(p.chatId, p.body, p.key)}
            onRespond={respond}
            onToast={setToast}
          />
        ) : (
          <section className="msg-thread msg-none d-only" aria-label="Conversation">
            <Empty icon="chat" title="Pick a chat">
              <span>Choose a conversation on the left to see messages and offers.</span>
            </Empty>
          </section>
        )}
      </div>
      {toast && <Toast>{toast}</Toast>}
    </div>
  )
}

function ChatRow({ c, active, unread, now }: { c: ChatSummary; active: boolean; unread: number; now: number }) {
  return (
    <Link to={`/chats/${c.id}`} className={cx('msg-row', active && 'on', unread > 0 && 'unread')} aria-current={active ? 'page' : undefined}>
      <Thumb listing={c.listing} size={24} className="msg-row-thumb">
        <span className="msg-row-av" aria-hidden="true">{c.other.initials}</span>
      </Thumb>
      <span className="msg-row-body">
        <span className="msg-row-top">
          <strong>{c.other.name}</strong>
          {c.other.verified && <VerifiedMark size={14} />}
          <span className="msg-row-time">{ago(c.last_at, now)}</span>
        </span>
        <span className="msg-row-item">{c.role === 'selling' ? 'Selling' : 'Buying'} · {c.listing.title}</span>
        <span className="msg-row-last">{c.last || 'No messages yet'}</span>
      </span>
      {unread > 0 && <span className="msg-dot"><span className="sr">{unread} unread</span></span>}
    </Link>
  )
}

function Thread({ chatId, chat, summary, error, onRetry, pending, now, onSend, onRetrySend, onRespond, onToast }: {
  chatId: number
  chat: Chat | null
  summary: ChatSummary | null
  error: string | null
  onRetry: () => void
  pending: Pending[]
  now: number
  onSend: (body: string) => void
  onRetrySend: (p: Pending) => void
  onRespond: (m: Message, action: 'accept' | 'decline' | 'counter', amount?: number) => void
  onToast: (t: string) => void
}) {
  const head: ChatSummary | null = chat ?? summary
  const [draft, setDraft] = useState('')
  const [counter, setCounter] = useState<{ m: Message; amount: number } | null>(null)
  const [menu, setMenu] = useState(false)
  const [placeholder, setPlaceholder] = useState('Message')
  useEffect(() => {
    if (window.matchMedia('(min-width: 900px)').matches) setPlaceholder('Write a message…')
  }, [])
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const count = (chat?.messages.length ?? 0) + pending.length
  const lastOffer = chat?.messages[chat.messages.length - 1]?.offer_status

  // Keep the newest message in view (unless the reader scrolled up to read history).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [count, lastOffer, chat ? 1 : 0])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const submit = (text: string, refocus: boolean) => {
    const body = text.trim()
    if (!body) return
    stick.current = true
    onSend(body)
    if (refocus) {
      setDraft('')
      inputRef.current?.focus()
    }
  }

  if (!head && error) {
    return (
      <section className="msg-thread" aria-label="Conversation">
        <div className="msg-head">
          <Link to="/chats" className="msg-back m-only" aria-label="Back to chats"><Icon name="back" size={22} width={2.2} /></Link>
          <strong className="msg-head-title">Chat</strong>
        </div>
        <ErrorBox message={error} onRetry={onRetry} />
      </section>
    )
  }

  const name = head?.other.name ?? ''
  const them = firstName(name)
  const otherRole = head?.role === 'selling' ? 'buyer' : 'seller'

  // Group messages by day for the "Today" separators.
  const items: React.ReactNode[] = []
  let lastDay = ''
  for (const m of chat?.messages ?? []) {
    const label = dayLabel(m.created_at, now)
    if (label !== lastDay) {
      items.push(<span key={`d-${m.id}`} className="msg-day">{label}</span>)
      lastDay = label
    }
    items.push(m.kind === 'offer' && chat
      ? <OfferCard key={m.id} m={m} chat={chat} onRespond={onRespond} onCounter={() => setCounter({ m, amount: (m.amount ?? 0) + 1500 })} />
      : <div key={m.id} className={cx('msg-bubble', m.mine ? 'mine' : 'theirs')}>{m.body}</div>)
  }
  if (pending.length && lastDay !== 'Today') items.push(<span key="d-pending" className="msg-day">Today</span>)
  for (const p of pending) {
    items.push(
      <div key={p.key} className={cx('msg-bubble mine', p.failed ? 'failed' : 'sending')}>
        {p.body}
        {p.failed && <button type="button" className="msg-retry" onClick={() => onRetrySend(p)}>Not sent · Tap to retry</button>}
        {!p.failed && <span className="sr">Sending</span>}
      </div>,
    )
  }

  return (
    <section className="msg-thread" aria-label={name ? `Conversation with ${name}` : 'Conversation'}>
      <div className="msg-head">
        <Link to="/chats" className="msg-back m-only" aria-label="Back to chats"><Icon name="back" size={22} width={2.2} /></Link>
        {head ? (
          <>
            <span className="msg-av" aria-hidden="true">{head.other.initials}</span>
            <span className="msg-who">
              <strong>{name}{head.other.verified && <span className="d-only"><VerifiedMark size={16} /></span>}</strong>
              <span className="m-only msg-online">Online · {head.other.verified ? 'verified ' : ''}{otherRole}</span>
              <span className="d-only msg-meta">{otherRole === 'buyer' ? 'Buyer' : 'Seller'} · {head.other.verified ? 'ID verified on Haat' : 'Not verified yet'}{head.other.ratings ? ` · ${head.other.ratings} ratings, ${head.other.positive}% positive` : ''}{head.other.reply_time ? ` · Usually replies in ${head.other.reply_time.replace('~', '')}` : ''}</span>
            </span>
          </>
        ) : (
          <span className="msg-who"><span className="skeleton msg-skel-line" /><span className="skeleton msg-skel-line short" /></span>
        )}
        <div className="msg-more">
          <button type="button" className="msg-more-btn" aria-label="More options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            <Icon name="more" size={20} width={3} />
          </button>
          {menu && head && (
            <>
              <button type="button" className="msg-menu-scrim" aria-label="Close menu" tabIndex={-1} onClick={() => setMenu(false)} />
              <div role="menu" className="msg-menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
                <Link role="menuitem" to={`/listing/${head.listing.id}`} autoFocus>View listing</Link>
                <button role="menuitem" type="button" onClick={() => { setMenu(false); onToast('Thanks. Our safety team will review this chat.') }}>Report {them}</button>
                <button role="menuitem" type="button" onClick={() => { setMenu(false); onToast(`${them} is blocked`) }}>Block {them}</button>
              </div>
            </>
          )}
        </div>
      </div>

      {head && (
        <Link to={`/listing/${head.listing.id}`} className="msg-item">
          <Thumb listing={head.listing} size={22} className="msg-item-thumb" />
          <span className="msg-item-body">
            <span className="msg-item-title">{head.listing.title}</span>
            <span className="msg-item-line"><span className="m-only">{priceLine(head.listing)}</span><span className="d-only">{priceLineLong(head)}</span></span>
          </span>
          <Icon name="right" size={16} stroke="#5B665F" width={2.2} className="m-only" />
          <span className="d-only msg-item-go">View listing</span>
        </Link>
      )}

      <div className="msg-scroll" ref={scrollRef} onScroll={onScroll} aria-live="polite" aria-relevant="additions">
        {!chat ? (
          error ? <ErrorBox message={error} onRetry={onRetry} /> : (
            <div className="msg-skel" aria-busy="true" aria-label="Loading messages">
              <span className="skeleton theirs" /><span className="skeleton mine" /><span className="skeleton theirs tall" />
            </div>
          )
        ) : (
          <>
            {items.length === 0 && <p className="msg-start">Say hello to {them} and ask anything about the item.</p>}
            {items}
          </>
        )}
        <p className="msg-safety">
          <Icon name="shield" size={16} width={2} />
          Keep payment on Haat. Never share your OTP or UPI PIN — we'll never ask for it.
        </p>
      </div>

      <div className="msg-compose">
        <div className="msg-quick" aria-label="Quick replies">
          {QUICK[head?.role ?? 'buying'].map((t) => (
            <button key={t} type="button" onClick={() => submit(t, false)} disabled={!chat}>{t}</button>
          ))}
        </div>
        <form className="msg-form" onSubmit={(e) => { e.preventDefault(); submit(draft, true) }}>
          <button type="button" className="msg-attach" aria-label="Attach photo" onClick={() => onToast('Photo sharing is coming soon')}>
            <Icon name="plus" size={20} width={2.2} className="m-only" />
            <Icon name="image" size={20} width={1.8} className="d-only" />
          </button>
          <label htmlFor={`msg-in-${chatId}`} className="sr">Message</label>
          <input
            ref={inputRef}
            id={`msg-in-${chatId}`}
            className="msg-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            enterKeyHint="send"
            maxLength={2000}
          />
          <button type="submit" className="msg-send" aria-label="Send" disabled={!chat} onMouseDown={(e) => e.preventDefault()}>
            <Icon name="send" size={18} stroke="#fff" width={2} />
          </button>
        </form>
      </div>

      {counter && (
        <Sheet title="Counter-offer" onClose={() => setCounter(null)}>
          <p className="msg-sheet-note">
            {them} offered <strong>{inr(counter.m.amount ?? 0)}</strong>
            {head && head.listing.format !== 'free' && <> · {priceLine(head.listing)}</>}
          </p>
          <Stepper value={counter.amount} onChange={(amount) => setCounter({ ...counter, amount })} step={500} min={500} format={inr} />
          <button
            type="button"
            className="btn primary block"
            onClick={() => {
              onRespond(counter.m, 'counter', counter.amount)
              stick.current = true
              setCounter(null)
            }}
          >
            Send counter-offer · {inr(counter.amount)}
          </button>
        </Sheet>
      )}
    </section>
  )
}

function OfferCard({ m, chat, onRespond, onCounter }: {
  m: Message
  chat: Chat
  onRespond: (m: Message, action: 'accept' | 'decline' | 'counter', amount?: number) => void
  onCounter: () => void
}) {
  const them = firstName(chat.other.name)
  const isCounter = m.body === 'Counter-offer'
  const kind = isCounter ? 'COUNTER-OFFER' : 'OFFER'
  const label = m.mine ? `YOUR ${kind}` : kind
  const line = isCounter ? 'Pays by UPI on Haat Pay' : m.body
  const temp = m.id < 0

  // The counter that answered this offer (the next offer from the other side).
  const idx = chat.messages.findIndex((x) => x.id === m.id)
  const reply = chat.messages.slice(idx + 1).find((x) => x.kind === 'offer' && x.mine !== m.mine)
  const iPay = chat.role === 'buying'

  let status: { text: string; tone: 'ok' | 'bad' | 'info' | 'wait' } | null = null
  if (m.offer_status === 'pending' && m.mine) status = { text: temp ? 'Sending…' : `Waiting for ${them} to reply`, tone: 'wait' }
  else if (m.offer_status === 'accepted') {
    status = m.mine
      ? { text: `${them} accepted your offer${iPay ? ' — pay by UPI on Haat Pay' : ''}`, tone: 'ok' }
      : { text: iPay ? 'Accepted — pay by UPI on Haat Pay to confirm' : `Accepted — waiting for ${them} to pay by UPI`, tone: 'ok' }
  } else if (m.offer_status === 'declined') status = { text: m.mine ? `${them} declined your offer` : 'Offer declined', tone: 'bad' }
  else if (m.offer_status === 'countered') {
    const amt = reply?.amount ? ` with ${inr(reply.amount)}` : ''
    status = { text: m.mine ? `${them} countered${amt}` : `You countered${amt}${reply?.offer_status === 'pending' ? ` · waiting for ${them}` : ''}`, tone: 'info' }
  }

  return (
    <div className={cx('msg-offer', m.mine ? 'mine' : 'theirs')}>
      <div className="msg-offer-body">
        <span className="msg-offer-label">{label}<span className="d-only">{!m.mine && ` FROM ${them.toUpperCase()}`}</span></span>
        <strong className="display msg-offer-amt">{inr(m.amount ?? 0)}</strong>
        <span className="msg-offer-line">{line}</span>
      </div>
      {m.offer_status === 'pending' && !m.mine ? (
        <div className="msg-offer-actions">
          <button type="button" className="decline" onClick={() => onRespond(m, 'decline')}>Decline</button>
          <button type="button" className="accept" onClick={() => onRespond(m, 'accept')}>Accept</button>
          <button type="button" className="counter" onClick={onCounter}>
            <span className="m-only">Counter-offer</span>
            <span className="d-only">Counter {inr((m.amount ?? 0) + 1500)}</span>
          </button>
        </div>
      ) : status && (
        <div role="status" className={cx('msg-offer-status', status.tone)}>{status.text}</div>
      )}
    </div>
  )
}
