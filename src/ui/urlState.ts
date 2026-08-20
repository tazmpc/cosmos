import { RATES } from './timeControls'

/**
 * Deep links — the whole view as a URL hash fragment, and back.
 *
 * Pure: no DOM, no globals, no throwing. The app is deployed at a subpath (GitHub Pages
 * /cosmos/), so state lives ONLY in the fragment — never the path, never the query — and the
 * writer in main.ts uses history.replaceState('#' + encodeViewState(...)) accordingly.
 *
 * Decoding is deliberately forgiving. A link is a thing humans forward, truncate, and hand-edit,
 * and a URL a bot appended `?utm_source=` (or `&fbclid=`) to must still open the view it names.
 * So: unknown keys are ignored, a malformed field is dropped rather than poisoning the state
 * with NaN, out-of-range numbers are clamped to what the controls would accept anyway, and
 * nothing in here can throw. A fragment with nothing recognisable in it decodes to null, which
 * main.ts reads as "just boot the default view".
 */

/**
 * What a deep link points at. `kind` matches SearchEntry.kind; `key` is the STABLE identifier
 * for that kind — a planet/moon/galaxy/dso/asteroid/spacecraft id, or, for a star, its NAME.
 * Stars deliberately do not use SearchEntry.key: that is an index into stars.bin, which is a
 * build artefact whose ordering is free to change between catalog rebuilds. A link that has
 * been sitting in someone's notes for a year must still resolve, so it names 'Sirius'.
 */
export interface FocusRef {
  kind: string
  key: string
}

export interface ViewState {
  mode: 'orbit' | 'sky'
  /** Orbit mode only — what the camera is orbiting. */
  focus?: FocusRef
  /** Orbit mode only — camera distance from the focus, in AU. */
  d?: number
  /** Camera yaw in radians (orbit: around the focus; sky: look direction). */
  yaw?: number
  /** Camera pitch in radians, |pitch| <= PITCH_LIMIT. */
  pitch?: number
  /** Sky mode only — vertical field of view in degrees. */
  fov?: number
  /** Simulation date, ISO 8601 UTC. */
  t?: string
  /** Simulation rate in sim-seconds per real second; always one of RATES. */
  rate?: number
}

/** Same limits FocusOrbitControls enforces (see cameraControls.ts): MAX_DIST_AU is ~1.9 Gpc,
 *  just past the deepest galaxy in the catalog, and the minimum is well inside any body's
 *  minApproachAu (which re-clamps on setFocus anyway). */
export const D_MIN_AU = 1e-7
export const D_MAX_AU = 4e14
/** ±1.52 rad ≈ 87.1° — the poles are unreachable in both control classes (lookAt roll goes
 *  unstable near camera.up), so a link can't ask for one either. */
export const PITCH_LIMIT = 1.52
/** SkyViewControls' own wheel-zoom fov limits. */
export const FOV_MIN = 15
export const FOV_MAX = 90

const KNOWN_KEYS = ['mode', 'focus', 'd', 'yaw', 'pitch', 'fov', 't', 'rate'] as const

// ---------------------------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------------------------

/** Trims a fixed-decimal string back to its shortest exact form ('1.2340' -> '1.234'). */
function trim(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** Angles: 4 decimals ≈ 0.0057°, finer than a single pixel of drag at any sane FOV. */
function fmtAngle(v: number): string {
  return trim(v.toFixed(4))
}

/**
 * Distance in AU at 6 significant digits. This one number spans from a few thousand km
 * (~1e-5 AU, parked next to a moon) to 1.9 Gpc (4e14 AU), so fixed decimals are useless at one
 * end or the other: small and huge values go exponential, the everyday middle stays plain.
 *
 * The '+' of a positive exponent is stripped rather than percent-encoded: URLSearchParams reads
 * a literal '+' in a value as a SPACE, so '4e+14' would decode to '4e 14' -> NaN. '4e14' parses
 * identically and survives any parser.
 */
function fmtAu(v: number): string {
  const a = Math.abs(v)
  if (a !== 0 && (a < 1e-2 || a >= 1e7)) {
    return v.toExponential(5).replace(/\.?0+e/, 'e').replace('e+', 'e')
  }
  return String(Number(v.toPrecision(6)))
}

/** Percent-encodes a value, but leaves ':' literal — 'focus=planet:saturn' is worth reading. */
function enc(v: string): string {
  return encodeURIComponent(v).replace(/%3A/g, ':')
}

/**
 * The view as a hash fragment body (no leading '#'). Undefined fields are omitted entirely, so
 * a minimal state is just 'mode=orbit'. Field order is fixed so an unchanged view always
 * produces a byte-identical string — that is what lets the 1 Hz writer skip a no-op
 * replaceState by simple string comparison.
 */
export function encodeViewState(s: ViewState): string {
  const parts: string[] = [`mode=${s.mode === 'sky' ? 'sky' : 'orbit'}`]
  if (s.focus) parts.push(`focus=${enc(`${s.focus.kind}:${s.focus.key}`)}`)
  if (s.d !== undefined && Number.isFinite(s.d)) parts.push(`d=${enc(fmtAu(s.d))}`)
  if (s.yaw !== undefined && Number.isFinite(s.yaw)) parts.push(`yaw=${enc(fmtAngle(s.yaw))}`)
  if (s.pitch !== undefined && Number.isFinite(s.pitch)) parts.push(`pitch=${enc(fmtAngle(s.pitch))}`)
  if (s.fov !== undefined && Number.isFinite(s.fov)) parts.push(`fov=${enc(trim(s.fov.toFixed(2)))}`)
  if (s.t !== undefined) parts.push(`t=${enc(s.t)}`)
  if (s.rate !== undefined && Number.isFinite(s.rate)) parts.push(`rate=${enc(String(s.rate))}`)
  return parts.join('&')
}

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** A finite number for `key`, or undefined. Rejects '' (which Number() reads as 0), 'NaN',
 *  'Infinity' and anything else that isn't a real magnitude. */
function num(p: URLSearchParams, key: string): number | undefined {
  const raw = p.get(key)
  if (raw === null || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Nearest rate on the app's ladder, compared in LOG space. The ladder is geometric (1 s/s to
 * 1 yr/s over seven steps), so linear nearest-neighbour would drag almost every input to the
 * top step; log distance treats "twice as fast" as the same gap everywhere.
 */
function snapRate(v: number): number {
  let best = RATES[0]
  let bestErr = Infinity
  for (const r of RATES) {
    const err = Math.abs(Math.log(v / r))
    if (err < bestErr) { bestErr = err; best = r }
  }
  return best
}

/** Rejects the loose, engine-specific things Date() will happily accept ('5' -> year 2001) by
 *  requiring an actual ISO 8601 calendar date, optionally with a time and zone. */
const ISO_RE = /^[+-]?\d{4,6}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/

function isoDate(p: URLSearchParams): string | undefined {
  const raw = p.get('t')
  if (raw === null || !ISO_RE.test(raw.trim())) return undefined
  const ms = Date.parse(raw.trim())
  if (!Number.isFinite(ms)) return undefined
  try {
    return new Date(ms).toISOString() // throws RangeError beyond ±8.64e15 ms
  } catch {
    return undefined
  }
}

function focusRef(p: URLSearchParams): FocusRef | undefined {
  const raw = p.get('focus')
  if (!raw) return undefined
  // First colon only: a key is free to contain more of them.
  const i = raw.indexOf(':')
  if (i <= 0 || i >= raw.length - 1) return undefined
  return { kind: raw.slice(0, i), key: raw.slice(i + 1) }
}

/**
 * Parses a hash fragment (with or without the leading '#') into a ViewState, or null when the
 * fragment holds nothing this app recognises — an empty hash, a plain anchor like '#about', or
 * pure garbage. Never throws.
 */
export function decodeViewState(hash: string): ViewState | null {
  if (typeof hash !== 'string') return null
  const raw = hash.replace(/^#/, '').trim()
  if (!raw) return null

  let p: URLSearchParams
  try {
    p = new URLSearchParams(raw)
  } catch {
    return null // not reachable with today's URLSearchParams, but this function may never throw
  }
  // Nothing addressed to us (a plain '#section-3' anchor, someone else's fragment router) —
  // leave the app at its default view rather than half-applying junk.
  if (!KNOWN_KEYS.some((k) => p.has(k))) return null

  const out: ViewState = { mode: p.get('mode') === 'sky' ? 'sky' : 'orbit' }

  const focus = focusRef(p)
  if (focus) out.focus = focus

  const d = num(p, 'd')
  if (d !== undefined) out.d = clamp(d, D_MIN_AU, D_MAX_AU)

  const yaw = num(p, 'yaw')
  if (yaw !== undefined) out.yaw = yaw // unclamped: yaw is periodic, any finite value is legal

  const pitch = num(p, 'pitch')
  if (pitch !== undefined) out.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT)

  const fov = num(p, 'fov')
  if (fov !== undefined) out.fov = clamp(fov, FOV_MIN, FOV_MAX)

  const t = isoDate(p)
  if (t !== undefined) out.t = t

  const rate = num(p, 'rate')
  // Time never runs backwards or stops via the rate ladder (pause is separate UI state), so a
  // zero or negative rate is meaningless — dropped rather than snapped to something arbitrary.
  if (rate !== undefined && rate > 0) out.rate = snapRate(rate)

  return out
}
