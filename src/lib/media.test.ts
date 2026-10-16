import { describe, expect, it } from 'vitest'
import { MAX_MEDIA_BYTES, checkSize, fitWithin, isExpired, mediaPath } from './media'

describe('view-once media helpers', () => {
  it('rejects videos over the limit with a message that says how big they are', () => {
    expect(() => checkSize(MAX_MEDIA_BYTES, 'video')).not.toThrow()
    expect(() => checkSize(MAX_MEDIA_BYTES + 1, 'video')).toThrow(/Videos can be up to 45 MB/)
    expect(() => checkSize(120 * 1024 * 1024, 'video')).toThrow(/That video is 120 MB/)
  })

  it('shrinks photos to fit 1600px on the long edge, keeping the shape', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 })
  })

  it('never enlarges small photos', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('expires unopened media after 3 days', () => {
    const now = Date.UTC(2026, 9, 17)
    const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString()
    expect(isExpired(daysAgo(2.9), now)).toBe(false)
    expect(isExpired(daysAgo(3.1), now)).toBe(true)
  })

  it('stores files under the space, named by message', () => {
    expect(mediaPath('s-1', 'm-1')).toBe('s-1/m-1')
  })
})
