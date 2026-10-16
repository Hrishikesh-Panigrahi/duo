// Direct phone-to-phone delivery of view-once photos and videos, used when
// both apps are open, so the file never touches a server.
//
// The file is already end-to-end encrypted before it gets here. WebRTC adds
// its own encryption on top, and the signalling messages that set up the
// connection travel over Supabase Realtime sealed with the space's key, so
// nobody else can join or even see the phones' network addresses.
//
// If a direct connection can't be made (some mobile networks block them),
// sendFile rejects and the caller falls back to encrypted Storage.
//
// Only Cloudflare's STUN server is used (to learn each phone's public
// address), since Cloudflare already serves the app. There's deliberately no
// relay (TURN) server: a file either goes phone to phone or not at all.

export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]
/** Safe for every browser's data channel message size. */
export const CHUNK_BYTES = 16 * 1024
const CONNECT_TIMEOUT_MS = 8_000
const TRANSFER_TIMEOUT_MS = 120_000
const MAX_FILE_BYTES = 50 * 1024 * 1024
/** At most this many incoming transfers at once. */
const MAX_INCOMING = 4
const STORED = 'stored'

type Route = { session: string; from: string; to: string }
export type Signal =
  | (Route & { type: 'offer'; sdp: RTCSessionDescriptionInit })
  | (Route & { type: 'answer'; sdp: RTCSessionDescriptionInit })
  | (Route & { type: 'ice'; candidate: RTCIceCandidateInit })
  | (Route & { type: 'bye' })

export type Header = { messageId: string; size: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The first data channel message names the file and its size; anything else is refused. */
export function parseHeader(data: unknown): Header | null {
  if (typeof data !== 'string') return null
  try {
    const h = JSON.parse(data) as Partial<Header>
    if (typeof h.messageId !== 'string' || !UUID.test(h.messageId)) return null
    if (typeof h.size !== 'number' || !Number.isInteger(h.size) || h.size <= 0 || h.size > MAX_FILE_BYTES) return null
    return { messageId: h.messageId, size: h.size }
  } catch {
    return null
  }
}

/** Joins received chunks back into one buffer. */
export function joinChunks(parts: ArrayBuffer[], size: number): ArrayBuffer {
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(new Uint8Array(p), at)
    at += p.byteLength
  }
  return out.buffer
}

export const directSupported = () => typeof RTCPeerConnection !== 'undefined'

type Session = { pc: RTCPeerConnection; pendingIce: RTCIceCandidateInit[]; remoteSet: boolean; answered?: boolean; abort: () => void }

export function createDirectLink(opts: {
  selfId: string
  sendSignal: (s: Signal) => Promise<void>
  /** Only the other member of the space may send us files. */
  acceptFrom: (userId: string) => boolean
  /** Receives the still-encrypted bytes; must have stored them when it resolves. */
  onFile: (messageId: string, bytes: ArrayBuffer) => Promise<void>
}) {
  const sessions = new Map<string, Session>()
  const signal = (s: Signal) => opts.sendSignal(s).catch(() => {})

  async function addRemote(s: Session, sdp: RTCSessionDescriptionInit) {
    await s.pc.setRemoteDescription(sdp)
    s.remoteSet = true
    for (const c of s.pendingIce.splice(0)) await s.pc.addIceCandidate(c).catch(() => {})
  }

  /** Sends encrypted bytes to `to`. Resolves once their phone has stored them. */
  function sendFile(to: string, messageId: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    return new Promise((resolve, reject) => {
      const session = crypto.randomUUID()
      const route = { session, from: opts.selfId, to }
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      const dc = pc.createDataChannel('media', { ordered: true })
      dc.binaryType = 'arraybuffer'
      dc.bufferedAmountLowThreshold = 1 << 20
      let settled = false

      const finish = (err?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(connectTimer)
        clearTimeout(transferTimer)
        sessions.delete(session)
        try {
          dc.close()
        } catch {
          // already closed
        }
        pc.close()
        if (err) {
          void signal({ ...route, type: 'bye' })
          reject(err)
        } else {
          resolve()
        }
      }
      const connectTimer = setTimeout(() => finish(new Error("Couldn't connect directly")), CONNECT_TIMEOUT_MS)
      const transferTimer = setTimeout(() => finish(new Error('Direct transfer took too long')), TRANSFER_TIMEOUT_MS)
      sessions.set(session, { pc, pendingIce: [], remoteSet: false, abort: () => finish(new Error('The other phone stopped the transfer')) })

      pc.onicecandidate = (e) => {
        if (e.candidate) void signal({ ...route, type: 'ice', candidate: e.candidate.toJSON() })
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') finish(new Error("Couldn't connect directly"))
      }
      dc.onopen = async () => {
        clearTimeout(connectTimer)
        try {
          dc.send(JSON.stringify({ messageId, size: bytes.byteLength } satisfies Header))
          for (let at = 0; at < bytes.byteLength; at += CHUNK_BYTES) {
            if (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
              await new Promise((r) => dc.addEventListener('bufferedamountlow', r, { once: true }))
            }
            dc.send(bytes.subarray(at, at + CHUNK_BYTES))
          }
        } catch (e) {
          finish(e as Error)
        }
      }
      dc.onmessage = (e) => {
        if (e.data === STORED) finish()
      }
      dc.onclose = () => finish(new Error('The direct connection closed early'))

      void (async () => {
        await pc.setLocalDescription(await pc.createOffer())
        await opts.sendSignal({ ...route, type: 'offer', sdp: pc.localDescription!.toJSON() })
      })().catch((e) => finish(e as Error))
    })
  }

  function receive(offer: Extract<Signal, { type: 'offer' }>) {
    const route = { session: offer.session, from: opts.selfId, to: offer.from }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    let done = false
    const cleanup = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      sessions.delete(offer.session)
      pc.close()
    }
    const timer = setTimeout(cleanup, TRANSFER_TIMEOUT_MS)
    const s: Session = { pc, pendingIce: [], remoteSet: false, abort: cleanup }
    sessions.set(offer.session, s)

    pc.onicecandidate = (e) => {
      if (e.candidate) void signal({ ...route, type: 'ice', candidate: e.candidate.toJSON() })
    }
    pc.ondatachannel = (e) => {
      const dc = e.channel
      dc.binaryType = 'arraybuffer'
      let header: Header | null = null
      const parts: ArrayBuffer[] = []
      let received = 0
      let complete = false
      dc.onmessage = (ev) => {
        if (complete) return
        if (!header) {
          header = parseHeader(ev.data)
          if (!header) cleanup()
          return
        }
        if (!(ev.data instanceof ArrayBuffer)) return cleanup()
        parts.push(ev.data)
        received += ev.data.byteLength
        if (received > header.size) return cleanup()
        if (received < header.size) return
        complete = true
        const bytes = joinChunks(parts, received)
        parts.length = 0
        // Only say it's stored once it is; otherwise the sender falls back to Storage.
        opts.onFile(header.messageId, bytes).then(
          () => {
            dc.send(STORED)
            setTimeout(cleanup, 1_000)
          },
          cleanup,
        )
      }
    }

    void (async () => {
      await addRemote(s, offer.sdp)
      await pc.setLocalDescription(await pc.createAnswer())
      await opts.sendSignal({ ...route, type: 'answer', sdp: pc.localDescription!.toJSON() })
    })().catch(cleanup)
  }

  return {
    sendFile,

    /** Handles a decrypted signalling message from the other phone. */
    handleSignal(s: Signal) {
      if (s.to !== opts.selfId || !opts.acceptFrom(s.from)) return
      if (s.type === 'offer') {
        if (directSupported() && !sessions.has(s.session) && sessions.size < MAX_INCOMING) receive(s)
        return
      }
      const session = sessions.get(s.session)
      if (!session) return
      if (s.type === 'answer') {
        // If they're signed in on two devices, both answer; the first one wins.
        if (session.answered) return
        session.answered = true
        void addRemote(session, s.sdp).catch(() => session.abort())
      } else if (s.type === 'ice') {
        if (session.remoteSet) void session.pc.addIceCandidate(s.candidate).catch(() => {})
        else session.pendingIce.push(s.candidate)
      } else if (s.type === 'bye') session.abort()
    },

    close() {
      for (const s of sessions.values()) s.abort()
    },
  }
}

export type DirectLink = ReturnType<typeof createDirectLink>
