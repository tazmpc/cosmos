import { describe, it, expect } from 'vitest'
import {
  encodeViewState, decodeViewState, D_MIN_AU, D_MAX_AU, PITCH_LIMIT, FOV_MIN, FOV_MAX,
  type ViewState,
} from './urlState'
import { RATES } from './timeControls'

/** encode -> decode, the operation every shared link performs. */
function roundTrip(s: ViewState): ViewState | null {
  return decodeViewState('#' + encodeViewState(s))
}

describe('encodeViewState', () => {
  it('omits every undefined field, keeping only mode for a minimal state', () => {
    expect(encodeViewState({ mode: 'orbit' })).toBe('mode=orbit')
  })

  it('emits a readable, URLSearchParams-parseable fragment', () => {
    const h = encodeViewState({
      mode: 'orbit', focus: { kind: 'planet', key: 'saturn' },
      d: 0.0012, yaw: 1.2345678, pitch: -0.5, t: '2026-08-19T12:00:00.000Z', rate: 1,
    })
    expect(h).toContain('mode=orbit')
    expect(h).toContain('focus=planet:saturn') // ':' left literal for readability
    const p = new URLSearchParams(h)
    expect(p.get('mode')).toBe('orbit')
    expect(p.get('focus')).toBe('planet:saturn')
    expect(p.get('d')).toBe('1.2e-3')
    expect(p.get('yaw')).toBe('1.2346') // 4 decimals
    expect(p.get('pitch')).toBe('-0.5')
    expect(p.get('t')).toBe('2026-08-19T12:00:00.000Z')
    expect(p.get('rate')).toBe('1')
  })

  it('never emits a bare "+" in an exponent (URLSearchParams would read it as a space)', () => {
    const h = encodeViewState({ mode: 'orbit', d: 4e14 })
    expect(h).not.toContain('+')
    expect(Number(new URLSearchParams(h).get('d'))).toBeCloseTo(4e14, -6)
  })

  it('percent-encodes a focus key containing a space or an ampersand', () => {
    const h = encodeViewState({ mode: 'orbit', focus: { kind: 'star', key: '51 Peg & co' } })
    expect(h).not.toMatch(/focus=star:51 /)
    expect(new URLSearchParams(h).get('focus')).toBe('star:51 Peg & co')
  })
})

describe('round-trip', () => {
  it('restores a full orbit state', () => {
    const s: ViewState = {
      mode: 'orbit', focus: { kind: 'planet', key: 'saturn' },
      d: 0.0032214, yaw: 1.2345, pitch: -0.5432, t: '2026-08-19T12:00:00.000Z', rate: 86400,
    }
    const out = roundTrip(s)
    expect(out).not.toBeNull()
    expect(out!.mode).toBe('orbit')
    expect(out!.focus).toEqual({ kind: 'planet', key: 'saturn' })
    expect(out!.d!).toBeCloseTo(0.0032214, 10)
    expect(out!.yaw!).toBeCloseTo(1.2345, 4)
    expect(out!.pitch!).toBeCloseTo(-0.5432, 4)
    expect(out!.t).toBe('2026-08-19T12:00:00.000Z')
    expect(out!.rate).toBe(86400)
  })

  it('restores a full sky state', () => {
    const s: ViewState = {
      mode: 'sky', yaw: -2.7183, pitch: 0.9, fov: 27.5, t: '2000-01-01T00:00:00.000Z', rate: 3600,
    }
    const out = roundTrip(s)
    expect(out!.mode).toBe('sky')
    expect(out!.yaw!).toBeCloseTo(-2.7183, 4)
    expect(out!.pitch!).toBeCloseTo(0.9, 4)
    expect(out!.fov!).toBeCloseTo(27.5, 2)
    expect(out!.t).toBe('2000-01-01T00:00:00.000Z')
    expect(out!.rate).toBe(3600)
    expect(out!.focus).toBeUndefined()
    expect(out!.d).toBeUndefined()
  })

  it('restores a minimal state', () => {
    expect(roundTrip({ mode: 'orbit' })).toEqual({ mode: 'orbit' })
    expect(roundTrip({ mode: 'sky' })).toEqual({ mode: 'sky' })
  })

  it('restores distances across the whole supported range', () => {
    for (const d of [1e-7, 2.5e-5, 0.0012, 1, 63241, 1.2e9, 4e14]) {
      const out = roundTrip({ mode: 'orbit', d })
      expect(out!.d! / d).toBeCloseTo(1, 5)
    }
  })

  it('restores a focus key containing spaces and colons (split on the FIRST colon only)', () => {
    const cases = [
      { kind: 'star', key: '51 Peg' },
      { kind: 'star', key: 'Alpha Centauri A' },
      { kind: 'dso', key: 'weird:id:with:colons' },
      { kind: 'asteroid', key: 'ceres' },
      { kind: 'dso', key: 'NGC 7000 (100%)' },
      { kind: 'spacecraft', key: 'a=b&c=d' },
    ]
    for (const focus of cases) {
      expect(roundTrip({ mode: 'orbit', focus })!.focus).toEqual(focus)
    }
  })
})

describe('decodeViewState — tolerance', () => {
  it('returns null for an absent or empty hash', () => {
    expect(decodeViewState('')).toBeNull()
    expect(decodeViewState('#')).toBeNull()
    expect(decodeViewState('   ')).toBeNull()
    expect(decodeViewState('#   ')).toBeNull()
  })

  it('returns null when nothing recognisable is present', () => {
    expect(decodeViewState('#hello world')).toBeNull()
    expect(decodeViewState('#section-3')).toBeNull()
    expect(decodeViewState('#a=1&b=2')).toBeNull()
  })

  it('never throws, whatever it is handed', () => {
    const junk = [
      '#%%%', '#%E0%A4%A', '#=', '#&&&&', '#mode', '#mode=', '#d=', '#focus=',
      '#focus=:', '#focus=planet:', '#focus=:saturn', '#'.padEnd(5000, 'x'),
      '#t=%%%', '#yaw=NaN&pitch=Infinity&d=-Infinity', '#rate=NaN',
      '#mode=orbit&mode=sky', '#d=1&d=2',
    ]
    for (const h of junk) expect(() => decodeViewState(h)).not.toThrow()
  })

  it('ignores unknown keys and keeps the known ones', () => {
    const out = decodeViewState('#mode=sky&wat=1&utm_source=twitter&fov=40&zzz=%%%')
    expect(out).toEqual({ mode: 'sky', fov: 40 })
  })

  it('ignores an unknown mode, defaulting to orbit', () => {
    expect(decodeViewState('#mode=hyperspace&d=5')).toEqual({ mode: 'orbit', d: 5 })
  })

  it('drops malformed numbers rather than emitting NaN', () => {
    const out = decodeViewState('#mode=orbit&d=abc&yaw=&pitch=--1&fov=null&rate=nope')
    expect(out).toEqual({ mode: 'orbit' })
    for (const k of ['d', 'yaw', 'pitch', 'fov', 'rate'] as const) {
      expect(out![k]).toBeUndefined()
    }
  })

  it('drops non-finite numbers', () => {
    const out = decodeViewState('#mode=orbit&d=Infinity&yaw=NaN&pitch=-Infinity&fov=Infinity')
    expect(out).toEqual({ mode: 'orbit' })
  })

  it('drops a malformed focus (missing kind or key)', () => {
    expect(decodeViewState('#focus=saturn&d=5')!.focus).toBeUndefined()
    expect(decodeViewState('#focus=planet:&d=5')!.focus).toBeUndefined()
    expect(decodeViewState('#focus=:saturn&d=5')!.focus).toBeUndefined()
  })
})

describe('decodeViewState — clamping', () => {
  it('clamps d into [1e-7, 4e14]', () => {
    expect(decodeViewState('#d=1e-30')!.d).toBe(D_MIN_AU)
    expect(decodeViewState('#d=0')!.d).toBe(D_MIN_AU)
    expect(decodeViewState('#d=-500')!.d).toBe(D_MIN_AU)
    expect(decodeViewState('#d=1e30')!.d).toBe(D_MAX_AU)
    expect(decodeViewState('#d=1')!.d).toBe(1)
  })

  it('clamps pitch into ±1.52 (the controls\' own pole limit)', () => {
    expect(decodeViewState('#pitch=3')!.pitch).toBe(PITCH_LIMIT)
    expect(decodeViewState('#pitch=-3')!.pitch).toBe(-PITCH_LIMIT)
    expect(decodeViewState('#pitch=1.5708')!.pitch).toBe(PITCH_LIMIT)
    expect(decodeViewState('#pitch=0.4')!.pitch).toBeCloseTo(0.4, 10)
  })

  it('clamps fov into [15, 90]', () => {
    expect(decodeViewState('#fov=1')!.fov).toBe(FOV_MIN)
    expect(decodeViewState('#fov=1000')!.fov).toBe(FOV_MAX)
    expect(decodeViewState('#fov=55')!.fov).toBe(55)
  })

  it('leaves yaw unclamped but finite (it wraps naturally)', () => {
    expect(decodeViewState('#yaw=100')!.yaw).toBe(100)
    expect(decodeViewState('#yaw=-9.5')!.yaw).toBe(-9.5)
  })
})

describe('decodeViewState — rate snapping', () => {
  it('snaps a near-miss rate to the app\'s own step', () => {
    expect(decodeViewState('#rate=86400.5')!.rate).toBe(86400)
    expect(decodeViewState('#rate=59.9')!.rate).toBe(60)
    expect(decodeViewState('#rate=1.0001')!.rate).toBe(1)
  })

  it('snaps out-of-range rates to the nearest end of the ladder', () => {
    expect(decodeViewState('#rate=1e-9')!.rate).toBe(Math.min(...RATES))
    expect(decodeViewState('#rate=1e30')!.rate).toBe(Math.max(...RATES))
  })

  it('accepts every real step unchanged', () => {
    for (const r of RATES) expect(decodeViewState(`#rate=${r}`)!.rate).toBe(r)
  })

  it('drops a zero or negative rate (time never runs backwards here)', () => {
    expect(decodeViewState('#mode=orbit&rate=0')!.rate).toBeUndefined()
    expect(decodeViewState('#mode=orbit&rate=-86400')!.rate).toBeUndefined()
  })
})

describe('decodeViewState — sim date', () => {
  it('normalises a valid ISO date to a canonical ISO string', () => {
    expect(decodeViewState('#t=2026-08-19T12:00:00.000Z')!.t).toBe('2026-08-19T12:00:00.000Z')
    expect(decodeViewState('#t=2026-08-19T12:00:00Z')!.t).toBe('2026-08-19T12:00:00.000Z')
    expect(decodeViewState('#t=2026-08-19')!.t).toBe('2026-08-19T00:00:00.000Z')
  })

  it('omits an invalid or non-ISO date instead of producing an Invalid Date', () => {
    for (const t of ['garbage', '5', 'yesterday', '2026-13-45T99:99:99Z', '', 'NaN']) {
      const out = decodeViewState(`#mode=orbit&t=${encodeURIComponent(t)}`)
      expect(out!.t).toBeUndefined()
    }
  })

  it('round-trips a date the app itself would produce', () => {
    const t = new Date(Date.UTC(1977, 8, 5, 12, 56, 0)).toISOString()
    expect(roundTrip({ mode: 'orbit', t })!.t).toBe(t)
  })
})
