import { describe, expect, it } from 'vitest'
import { CHUNK_BYTES, joinChunks, parseHeader } from './direct'

const id = '3f2b8c1e-9a4d-4e7f-8b2a-1c5d6e7f8a9b'

describe('direct transfer framing', () => {
  it('accepts a header naming a message and a sensible size', () => {
    expect(parseHeader(JSON.stringify({ messageId: id, size: 36556 }))).toEqual({ messageId: id, size: 36556 })
  })

  it('refuses anything else as a header', () => {
    expect(parseHeader(new ArrayBuffer(8))).toBeNull()
    expect(parseHeader('not json')).toBeNull()
    expect(parseHeader(JSON.stringify({ messageId: '../../etc', size: 10 }))).toBeNull()
    expect(parseHeader(JSON.stringify({ messageId: id, size: 0 }))).toBeNull()
    expect(parseHeader(JSON.stringify({ messageId: id, size: 1.5 }))).toBeNull()
    expect(parseHeader(JSON.stringify({ messageId: id, size: 60 * 1024 * 1024 }))).toBeNull()
  })

  it('puts chunks back together byte for byte', () => {
    const original = new Uint8Array(CHUNK_BYTES * 3 + 123).map((_, i) => (i * 7) % 256)
    const parts: ArrayBuffer[] = []
    for (let at = 0; at < original.length; at += CHUNK_BYTES) parts.push(original.slice(at, at + CHUNK_BYTES).buffer)
    expect(parts).toHaveLength(4)
    expect(new Uint8Array(joinChunks(parts, original.length))).toEqual(original)
  })
})
