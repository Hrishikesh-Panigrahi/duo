import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { contexts, decryptRecord, encryptRecord } from '../e2e'
import type { DirectLink, LinkOptions } from '../direct'
import { PresenceGate, Room, type RealtimeClient, type RoomChannel } from './room'

const S = 'space-1'
const ME = 'user-me'
const YOU = 'user-you'

// ── A fake Realtime connection the tests can drive ──
type Payload = Record<string, unknown>
class FakeChannel implements RoomChannel {
  presence: (Payload | null)[] = []
  sent: { event: string; payload: Payload }[] = []
  private presenceListeners: (() => void)[] = []
  private broadcastListeners = new Map<string, ((m: { payload?: Payload }) => void)[]>()
  private onStatus: (s: string) => void = () => {}
  private state: Record<string, { direct?: boolean }[]> = {}

  constructor(readonly topic: string) {}

  on(type: string, filter: { event: string }, cb: never) {
    if (type === 'presence') this.presenceListeners.push(cb)
    else this.broadcastListeners.set(filter.event, [...(this.broadcastListeners.get(filter.event) ?? []), cb])
    return this
  }
  subscribe(cb: (s: string) => void) {
    this.onStatus = cb
  }
  presenceState() {
    return this.state
  }
  async track(p: Payload) {
    this.presence.push(p)
  }
  async untrack() {
    this.presence.push(null)
  }
  async send(m: { event: string; payload: Payload }) {
    this.sent.push({ event: m.event, payload: m.payload })
    return 'ok'
  }

  status(s: string) {
    this.onStatus(s)
  }
  syncPresence(state: Record<string, { direct?: boolean }[]>) {
    this.state = state
    this.presenceListeners.forEach((f) => f())
  }
  broadcast(event: string, payload: Payload) {
    this.broadcastListeners.get(event)?.forEach((f) => f({ payload }))
  }
}

function fakeRealtime() {
  const channels: FakeChannel[] = []
  const rt: RealtimeClient = {
    channel(name) {
      const ch = new FakeChannel(`realtime:${name}`)
      channels.push(ch)
      return ch
    },
    removeChannel: async () => 'ok',
    getChannels: () => [],
  }
  return { rt, channels }
}

function fakeLink() {
  const link = { sendFile: vi.fn(async () => {}), handleSignal: vi.fn(), close: vi.fn() }
  let opts: LinkOptions | undefined
  const create = (o: LinkOptions) => {
    opts = o
    return link as unknown as DirectLink
  }
  return { link, create, opts: () => opts! }
}

let key: CryptoKey
beforeAll(async () => {
  key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})
beforeEach(() => {
  vi.useFakeTimers()
  // A browser that can do direct transfers.
  ;(globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = class {}
})
afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection
})

async function setUp(over: { key?: CryptoKey | null; visible?: boolean } = {}) {
  const { rt, channels } = fakeRealtime()
  const fl = fakeLink()
  const state = { key: over.key === undefined ? key : over.key, visible: over.visible ?? true }
  const onPartner = vi.fn()
  const onTyping = vi.fn()
  const room = new Room({
    spaceId: S,
    userId: ME,
    getKey: () => state.key,
    isPartner: (id) => id === YOU,
    onPartner,
    onTyping,
    onFile: async () => {},
    isVisible: () => state.visible,
    realtime: rt,
    createLink: fl.create,
  })
  // Joining waits for any previous leave to finish.
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
  else await new Promise((r) => setTimeout(r, 0))
  return { room, channels, state, onPartner, onTyping, ...fl }
}

describe('presence budget', () => {
  it('sends only real changes', () => {
    const sent: (string | null)[] = []
    const gate = new PresenceGate({ send: (s) => sent.push(s), canSend: () => true })
    gate.want('{"direct":true}')
    gate.want('{"direct":true}')
    gate.want('{"direct":true}')
    expect(sent).toEqual(['{"direct":true}'])
  })

  it('holds a burst under the limit, then delivers the latest state', () => {
    const sent: (string | null)[] = []
    const gate = new PresenceGate({ send: (s) => sent.push(s), canSend: () => true })
    for (let i = 0; i < 20; i++) gate.want(i % 2 ? '{"direct":true}' : null) // flicking between apps
    gate.want('{"direct":true}')
    expect(sent).toHaveLength(4) // the server allows 5 per 30 s
    vi.advanceTimersByTime(30_200)
    expect(sent).toHaveLength(5)
    expect(sent.at(-1)).toBe('{"direct":true}')
  })

  it('never sends while it cannot, and starts afresh on a new channel', () => {
    let can = false
    const sent: (string | null)[] = []
    const gate = new PresenceGate({ send: (s) => sent.push(s), canSend: () => can })
    gate.want('{"direct":true}')
    expect(sent).toEqual([])
    can = true
    gate.want('{"direct":true}')
    gate.reset()
    gate.want('{"direct":true}')
    expect(sent).toEqual(['{"direct":true}', '{"direct":true}'])
  })
})

describe('the room', () => {
  it('joins privately and says this device can take files, once subscribed', async () => {
    const { channels } = await setUp()
    expect(channels).toHaveLength(1)
    expect(channels[0].presence).toEqual([])
    channels[0].status('SUBSCRIBED')
    expect(channels[0].presence).toEqual([{ direct: true }])
  })

  it("says it can't take files while locked, and leaves when hidden", async () => {
    const { room, channels, state } = await setUp({ key: null })
    channels[0].status('SUBSCRIBED')
    expect(channels[0].presence).toEqual([{ direct: false }])
    state.visible = false
    room.syncPresence()
    expect(channels[0].presence).toEqual([{ direct: false }, null])
  })

  it('reports your person online, and whether they can take a file', async () => {
    const { room, channels, onPartner } = await setUp()
    channels[0].status('SUBSCRIBED')
    channels[0].syncPresence({ [ME]: [{ direct: true }], [YOU]: [{ direct: false }] })
    expect(onPartner).toHaveBeenLastCalledWith({ online: true, direct: false })
    expect(room.partnerCanTakeFile()).toBe(false)
    channels[0].syncPresence({ [ME]: [{ direct: true }], [YOU]: [{ direct: false }, { direct: true }] }) // two devices
    expect(room.partnerCanTakeFile()).toBe(true)
    channels[0].syncPresence({ [ME]: [{ direct: true }] })
    expect(onPartner).toHaveBeenLastCalledWith({ online: false, direct: false })
  })

  it('rejoins by itself when the server drops the room, backing off', async () => {
    const { room, channels, onPartner } = await setUp()
    channels[0].status('SUBSCRIBED')
    channels[0].syncPresence({ [YOU]: [{ direct: true }] })
    channels[0].status('CHANNEL_ERROR') // e.g. a rate limit
    expect(onPartner).toHaveBeenLastCalledWith({ online: false, direct: false })
    expect(room.partnerCanTakeFile()).toBe(false)
    await vi.advanceTimersByTimeAsync(999)
    expect(channels).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(channels).toHaveLength(2) // after 1 s
    channels[1].status('CLOSED')
    await vi.advanceTimersByTimeAsync(1999)
    expect(channels).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(channels).toHaveLength(3) // then after 2 s
    channels[2].status('SUBSCRIBED')
    expect(channels[2].presence).toEqual([{ direct: true }]) // announced again on the new channel
    channels[2].status('CHANNEL_ERROR')
    await vi.advanceTimersByTimeAsync(1000)
    expect(channels).toHaveLength(4) // back to 1 s after a success
  })

  it('stays gone once closed', async () => {
    const { room, channels, link } = await setUp()
    channels[0].status('SUBSCRIBED')
    room.close()
    channels[0].status('CLOSED')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(channels).toHaveLength(1)
    expect(link.close).toHaveBeenCalled()
  })

  it("shows your person typing, not yourself, and pings at most every 2.5 s", async () => {
    const { room, channels, onTyping } = await setUp()
    channels[0].status('SUBSCRIBED')
    channels[0].broadcast('typing', { user_id: ME })
    expect(onTyping).not.toHaveBeenCalled()
    channels[0].broadcast('typing', { user_id: YOU })
    expect(onTyping).toHaveBeenCalledTimes(1)
    room.sendTyping()
    room.sendTyping()
    vi.advanceTimersByTime(2400)
    room.sendTyping()
    vi.advanceTimersByTime(200)
    room.sendTyping()
    expect(channels[0].sent.filter((m) => m.event === 'typing')).toHaveLength(2)
  })
})

describe('signalling for direct transfers', () => {
  const offer = { type: 'offer', session: 's1', from: YOU, to: ME, sdp: { type: 'offer', sdp: 'v=0' } } as const
  const sealed = (at: number, k = key) => encryptRecord(k, contexts.signal(S), { signal: offer, at })
  // Decrypting takes real time (WebCrypto runs off the main thread), so these use real timers.
  beforeEach(() => vi.useRealTimers())
  const settle = () => new Promise((r) => setTimeout(r, 100))

  it('hands on a fresh, sealed signal', async () => {
    const { channels, link } = await setUp()
    channels[0].status('SUBSCRIBED')
    channels[0].broadcast('signal', { s: await sealed(Date.now()) })
    await settle()
    expect(link.handleSignal).toHaveBeenCalledWith(offer)
  })

  it('ignores a replay, a forgery, junk, and anything while locked', async () => {
    const { channels, link, state } = await setUp()
    channels[0].status('SUBSCRIBED')
    const other = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    channels[0].broadcast('signal', { s: await sealed(Date.now() - 3 * 60_000) }) // recorded earlier
    channels[0].broadcast('signal', { s: await sealed(Date.now(), other) }) // not sealed with our key
    const good = await sealed(Date.now())
    const parts = good.split(':')
    const flipped = parts[2][0] === 'A' ? 'B' : 'A'
    channels[0].broadcast('signal', { s: `${parts[0]}:${parts[1]}:${flipped}${parts[2].slice(1)}` }) // tampered
    const huge = await encryptRecord(key, contexts.signal(S), { signal: offer, at: Date.now(), pad: 'x'.repeat(70_000) })
    channels[0].broadcast('signal', { s: huge }) // sealed properly, but far too big to be a real signal
    channels[0].broadcast('signal', { s: { nested: 'object' } })
    state.key = null
    channels[0].broadcast('signal', { s: good }) // locked
    await settle()
    expect(link.handleSignal).not.toHaveBeenCalled()
    // Control: the same room does take a good one, so the above were really refused.
    state.key = key
    channels[0].broadcast('signal', { s: good })
    await settle()
    expect(link.handleSignal).toHaveBeenCalledTimes(1)
  })

  it('seals what it sends, and refuses to send when not connected', async () => {
    const { channels, opts } = await setUp()
    const signal = { type: 'bye', session: 's1', from: ME, to: YOU } as const
    await expect(opts().sendSignal(signal)).rejects.toThrow('Not connected')
    channels[0].status('SUBSCRIBED')
    await opts().sendSignal(signal)
    const s = channels[0].sent.find((m) => m.event === 'signal')?.payload.s as string
    expect(s).toMatch(/^v1:/)
    // Only the space's key opens it, and only as a signal for this space.
    expect(await decryptRecord(key, contexts.signal(S), s)).toMatchObject({ signal })
    const other = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await expect(decryptRecord(other, contexts.signal(S), s)).rejects.toThrow()
    await expect(decryptRecord(key, contexts.signal('another-space'), s)).rejects.toThrow()
    expect(opts().acceptFrom(YOU)).toBe(true)
    expect(opts().acceptFrom('stranger')).toBe(false)
  })
})
