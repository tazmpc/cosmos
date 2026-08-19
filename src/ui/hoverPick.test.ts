import { describe, it, expect } from 'vitest'
import {
  pickNearest, placeLabel, HOVER_PRIORITY, HOVER_LABEL_GAP_PX, HOVER_LABEL_RISE_PX,
  HOVER_LABEL_MARGIN_PX, type HoverCandidate,
} from './hoverPick'

function c(name: string, sx: number, sy: number, priority = 1): HoverCandidate {
  return { name, kind: 'star', label: 'star', sx, sy, priority }
}

describe('pickNearest', () => {
  it('returns null for an empty candidate list', () => {
    expect(pickNearest([], 100, 100, 16)).toBeNull()
  })

  it('returns null when every candidate is outside the radius', () => {
    expect(pickNearest([c('far', 200, 200)], 100, 100, 16)).toBeNull()
  })

  it('picks the nearest candidate within the radius', () => {
    const near = c('near', 105, 100)
    const mid = c('mid', 110, 100)
    expect(pickNearest([mid, near], 100, 100, 16)?.name).toBe('near')
    expect(pickNearest([near, mid], 100, 100, 16)?.name).toBe('near')
  })

  it('includes a candidate exactly on the radius boundary', () => {
    expect(pickNearest([c('edge', 116, 100)], 100, 100, 16)?.name).toBe('edge')
    expect(pickNearest([c('outside', 116.001, 100)], 100, 100, 16)).toBeNull()
  })

  it('breaks an exact distance tie by higher priority, regardless of input order', () => {
    const star = { ...c('Star', 108, 100), priority: 1 }
    const planet = { ...c('Planet', 100, 108), priority: 5 }
    expect(pickNearest([star, planet], 100, 100, 16)?.name).toBe('Planet')
    expect(pickNearest([planet, star], 100, 100, 16)?.name).toBe('Planet')
  })

  it('still prefers a strictly nearer low-priority candidate over a farther high-priority one', () => {
    const star = { ...c('Star', 101, 100), priority: 1 }
    const planet = { ...c('Planet', 110, 100), priority: 5 }
    expect(pickNearest([star, planet], 100, 100, 16)?.name).toBe('Star')
  })

  it('keeps the first candidate when distance and priority both tie', () => {
    const a = { ...c('A', 105, 100), priority: 2 }
    const b = { ...c('B', 95, 100), priority: 2 }
    expect(pickNearest([a, b], 100, 100, 16)?.name).toBe('A')
  })

  it('ranks kinds planet/moon > spacecraft > asteroid > galaxy/dso > star', () => {
    expect(HOVER_PRIORITY.planet).toBe(HOVER_PRIORITY.moon)
    expect(HOVER_PRIORITY.planet).toBeGreaterThan(HOVER_PRIORITY.spacecraft)
    expect(HOVER_PRIORITY.spacecraft).toBeGreaterThan(HOVER_PRIORITY.asteroid)
    expect(HOVER_PRIORITY.asteroid).toBeGreaterThan(HOVER_PRIORITY.galaxy)
    expect(HOVER_PRIORITY.galaxy).toBe(HOVER_PRIORITY.dso)
    expect(HOVER_PRIORITY.dso).toBeGreaterThan(HOVER_PRIORITY.star)
  })

  it('carries an arbitrary payload through on the winning candidate', () => {
    type Tagged = HoverCandidate & { tag: number }
    const cands: Tagged[] = [{ ...c('A', 105, 100), tag: 7 }, { ...c('B', 200, 100), tag: 9 }]
    expect(pickNearest(cands, 100, 100, 16)?.tag).toBe(7)
  })
})

describe('placeLabel', () => {
  const VIEW_W = 1000
  const VIEW_H = 800
  const W = 120
  const H = 24
  const place = (sx: number, sy: number) => placeLabel(sx, sy, W, H, VIEW_W, VIEW_H)

  it('sits to the upper right of the point when there is room', () => {
    expect(place(400, 400)).toEqual({
      x: 400 + HOVER_LABEL_GAP_PX, y: 400 - HOVER_LABEL_RISE_PX, flipped: false,
    })
  })

  it('flips to the left of the point when the right edge would clip it', () => {
    const p = place(950, 400)
    expect(p.flipped).toBe(true)
    expect(p.x).toBe(950 - HOVER_LABEL_GAP_PX - W)
    expect(p.x + W).toBeLessThanOrEqual(VIEW_W - HOVER_LABEL_MARGIN_PX)
  })

  it('clamps into view when flipping left would clip the left edge too', () => {
    // A point close to both edges of a viewport narrower than the label itself.
    const p = placeLabel(20, 400, 200, H, 180, VIEW_H)
    expect(p.x).toBe(HOVER_LABEL_MARGIN_PX)
  })

  it('clamps to the top margin near the top edge', () => {
    expect(place(400, 2).y).toBe(HOVER_LABEL_MARGIN_PX)
  })

  it('clamps to the bottom margin near the bottom edge', () => {
    expect(place(400, VIEW_H - 2).y).toBe(VIEW_H - H - HOVER_LABEL_MARGIN_PX)
  })

  it('keeps the label fully inside the viewport at every corner', () => {
    for (const sx of [0, 1, VIEW_W - 1, VIEW_W]) {
      for (const sy of [0, 1, VIEW_H - 1, VIEW_H]) {
        const p = place(sx, sy)
        expect(p.x).toBeGreaterThanOrEqual(HOVER_LABEL_MARGIN_PX)
        expect(p.y).toBeGreaterThanOrEqual(HOVER_LABEL_MARGIN_PX)
        expect(p.x + W).toBeLessThanOrEqual(VIEW_W - HOVER_LABEL_MARGIN_PX)
        expect(p.y + H).toBeLessThanOrEqual(VIEW_H - HOVER_LABEL_MARGIN_PX)
      }
    }
  })
})
