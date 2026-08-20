import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'
import { createObjectImagery, hipsUrl, vignetteFalloff, type HipsTextureLoader, type ImageTarget } from './objectImagery'
import { markGlowTextureShared } from './galaxySprites'
import { PC_TO_AU, AU_PER_LY } from '../data/units'

function makeTarget(id: string, overrides: Partial<ImageTarget> = {}): ImageTarget {
  const glowTexture = new THREE.Texture()
  const material = new THREE.SpriteMaterial({ map: glowTexture })
  const sprite = new THREE.Sprite(material)
  return {
    id,
    raHours: 5.5881,
    decDeg: -5.3911,
    diameterLy: 24,
    distPc: 412,
    sprite,
    truePos: new THREE.Vector3(0, 0, 0),
    ...overrides,
  }
}

/** Records every load() call and exposes its captured callbacks so tests can resolve/reject
 * fetches deterministically, without a real network round-trip. */
class FakeLoader implements HipsTextureLoader {
  calls: { url: string; onLoad: (t: THREE.Texture) => void; onError: (e: unknown) => void }[] = []
  load(url: string, onLoad: (t: THREE.Texture) => void, _onProgress: undefined, onError: (e: unknown) => void): void {
    this.calls.push({ url, onLoad, onError })
  }
}

describe('hipsUrl', () => {
  it('builds a hips2fits DSS2/color cutout URL from RA hours + Dec + FOV', () => {
    const url = hipsUrl(5.5881, -5.3911, 1.6)
    expect(url).toContain('hips=CDS%2FP%2FDSS2%2Fcolor')
    expect(url).toContain('ra=83.8215') // 5.5881 * 15
    expect(url).toContain('dec=-5.3911')
    expect(url).toContain('fov=1.6')
    expect(url).toContain('width=512&height=512&format=jpg&projection=TAN')
  })
})

describe('createObjectImagery', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { warnSpy.mockRestore() })

  it('does not fetch when the camera is far away', () => {
    const loader = new FakeLoader()
    const target = makeTarget('m42', { truePos: new THREE.Vector3(1e12, 0, 0) })
    const imagery = createObjectImagery([target], loader)
    imagery.update(new THREE.Vector3(0, 0, 0), 1) // one full check tick, but way outside 20x diameter
    expect(loader.calls).toHaveLength(0)
  })

  it('fetches once the camera is within 20x the object diameter, on the throttled tick', () => {
    const loader = new FakeLoader()
    const diameterAu = 24 * AU_PER_LY
    const target = makeTarget('m42', { truePos: new THREE.Vector3(5 * diameterAu, 0, 0) })
    const imagery = createObjectImagery([target], loader)
    imagery.update(new THREE.Vector3(0, 0, 0), 0.5) // under the 1s throttle — no check yet
    expect(loader.calls).toHaveLength(0)
    imagery.update(new THREE.Vector3(0, 0, 0), 0.5) // crosses the 1s threshold — check runs
    expect(loader.calls).toHaveLength(1)
  })

  it('on load, swaps the sprite material map and resizes to the true angular extent', () => {
    const loader = new FakeLoader()
    const target = makeTarget('m42')
    const imagery = createObjectImagery([target], loader)
    imagery.focus('m42')
    expect(loader.calls).toHaveLength(1)
    const photoTexture = new THREE.Texture()
    loader.calls[0].onLoad(photoTexture)
    const material = target.sprite.material as THREE.SpriteMaterial
    expect(material.map).toBe(photoTexture)
    // sizeAu = 2 * dist * tan(fov/2 in rad); dist = 412pc in AU, fov computed from angularSize
    const expectedSizeAu = 2 * (412 * PC_TO_AU) * Math.tan(((1.637 / 2) * Math.PI) / 180)
    expect(target.sprite.scale.x).toBeCloseTo(expectedSizeAu, -3) // within ~1000 AU at ~1e8 AU scale
  })

  it('on failure, keeps the glow texture, warns exactly once, and never retries', () => {
    const loader = new FakeLoader()
    const target = makeTarget('m42')
    const originalMap = (target.sprite.material as THREE.SpriteMaterial).map
    const imagery = createObjectImagery([target], loader)
    imagery.focus('m42')
    loader.calls[0].onError(new Error('network down'))
    expect((target.sprite.material as THREE.SpriteMaterial).map).toBe(originalMap)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // a later proximity check (or another focus()) must not re-fetch a failed object
    imagery.focus('m42')
    imagery.update(new THREE.Vector3(0, 0, 0), 2)
    expect(loader.calls).toHaveLength(1)
  })

  it('never fetches twice for the same object, even if focus() is called repeatedly', () => {
    const loader = new FakeLoader()
    const target = makeTarget('m42')
    const imagery = createObjectImagery([target], loader)
    imagery.focus('m42')
    imagery.focus('m42')
    imagery.focus('m42')
    expect(loader.calls).toHaveLength(1)
  })

  it('does not refetch a call to focus() after the photo already loaded successfully', () => {
    const loader = new FakeLoader()
    const target = makeTarget('m42')
    const imagery = createObjectImagery([target], loader)
    imagery.focus('m42')
    loader.calls[0].onLoad(new THREE.Texture())
    imagery.focus('m42') // re-focusing (e.g. searching the same object again) must be a no-op
    expect(loader.calls).toHaveLength(1)
  })

  it('focus() bypasses the proximity check entirely', () => {
    const loader = new FakeLoader()
    const target = makeTarget('m42', { truePos: new THREE.Vector3(1e15, 0, 0) }) // absurdly far
    const imagery = createObjectImagery([target], loader)
    imagery.focus('m42')
    expect(loader.calls).toHaveLength(1)
  })

  it('uses fovDegOverride instead of angularFovDeg(diameterLy, distPc) when set', () => {
    const loader = new FakeLoader()
    // distPc/diameterLy are deliberately inconsistent with the override, so the test can tell
    // which route actually drove the request — this mirrors OpenNGC objects, whose distPc is
    // only ever a type-based placeholder.
    const target = makeTarget('ngc891', { fovDegOverride: 0.36 })
    const imagery = createObjectImagery([target], loader)
    imagery.focus('ngc891')
    expect(loader.calls[0].url).toContain('fov=0.36')
  })

  describe('register', () => {
    it('is idle and un-fetched (not in the proximity sweep) until registered', () => {
      const loader = new FakeLoader()
      const imagery = createObjectImagery([], loader)
      // focus() on an unknown id is a documented no-op (see `focus`'s implementation: byId.get
      // returns undefined, fetchFor is never called).
      imagery.focus('ngc4565')
      expect(loader.calls).toHaveLength(0)
    })

    it('registers a new target so focus() can fetch it, exactly like a curated target', () => {
      const loader = new FakeLoader()
      const imagery = createObjectImagery([], loader)
      const target = makeTarget('ngc4565', { fovDegOverride: 0.45 })
      imagery.register(target)
      imagery.focus('ngc4565')
      expect(loader.calls).toHaveLength(1)
      expect(loader.calls[0].url).toContain('fov=0.45')
    })

    it('is idempotent: registering the same id twice keeps the first target and its state', () => {
      const loader = new FakeLoader()
      const imagery = createObjectImagery([], loader)
      const first = makeTarget('ngc4565', { fovDegOverride: 0.45 })
      const second = makeTarget('ngc4565', { fovDegOverride: 9.99 })
      imagery.register(first)
      imagery.focus('ngc4565') // starts loading against `first`
      imagery.register(second) // must not reset state or swap in `second`
      imagery.focus('ngc4565')
      expect(loader.calls).toHaveLength(1)
      expect(loader.calls[0].url).toContain('fov=0.45')
    })

    it('a registered target joins the proximity sweep going forward', () => {
      const loader = new FakeLoader()
      const imagery = createObjectImagery([], loader)
      const diameterAu = 100_000 * AU_PER_LY
      const target = makeTarget('ngc4565', {
        diameterLy: 100_000,
        truePos: new THREE.Vector3(5 * diameterAu, 0, 0),
      })
      imagery.register(target)
      imagery.update(new THREE.Vector3(0, 0, 0), 1)
      expect(loader.calls).toHaveLength(1)
    })
  })
})

describe('texture disposal on photo swap', () => {
  it('disposes a standalone (non-shared) glow texture once the photo replaces it', () => {
    const loader = new FakeLoader()
    const target = makeTarget('ngc-standalone') // makeTarget's texture is a plain, unmarked THREE.Texture
    const standaloneGlow = (target.sprite.material as THREE.SpriteMaterial).map!
    const disposeSpy = vi.spyOn(standaloneGlow, 'dispose')
    const imagery = createObjectImagery([target], loader)
    imagery.focus('ngc-standalone')
    loader.calls[0].onLoad(new THREE.Texture())
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  it('never disposes the shared curated glow texture, even after the photo replaces it', () => {
    const loader = new FakeLoader()
    const sharedGlow = markGlowTextureShared(new THREE.Texture())
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedGlow }))
    const target = makeTarget('m31', { sprite })
    const disposeSpy = vi.spyOn(sharedGlow, 'dispose')
    const imagery = createObjectImagery([target], loader)
    imagery.focus('m31')
    loader.calls[0].onLoad(new THREE.Texture())
    expect((target.sprite.material as THREE.SpriteMaterial).map).not.toBe(sharedGlow) // the swap did happen
    expect(disposeSpy).not.toHaveBeenCalled()
  })
})

describe('vignetteFalloff', () => {
  it('leaves the middle of the photo untouched', () => {
    expect(vignetteFalloff(0)).toBe(1)
    expect(vignetteFalloff(0.5)).toBe(1)
    expect(vignetteFalloff(0.62)).toBe(1)
  })

  it('reaches zero before the edge midpoint, so corners are gone entirely', () => {
    expect(vignetteFalloff(0.98)).toBe(0)
    expect(vignetteFalloff(1.0)).toBe(0)
    expect(vignetteFalloff(Math.SQRT2)).toBe(0) // a corner
  })

  it('falls off smoothly and monotonically in between', () => {
    let prev = 1
    for (let r = 0.62; r <= 0.98; r += 0.02) {
      const v = vignetteFalloff(r)
      expect(v).toBeLessThanOrEqual(prev + 1e-12)
      expect(v).toBeGreaterThanOrEqual(0)
      prev = v
    }
    expect(vignetteFalloff(0.8)).toBeGreaterThan(0.3)
    expect(vignetteFalloff(0.8)).toBeLessThan(0.7)
  })
})

describe('photo vignette', () => {
  it('keeps the loaded texture as-is when there is no DOM canvas to process it with', () => {
    // Node test env: vignetteTexture must degrade to the raw texture rather than throwing.
    const loader = new FakeLoader()
    const target = makeTarget('m42')
    const imagery = createObjectImagery([target], loader)
    imagery.focus('m42')
    const photoTexture = new THREE.Texture()
    loader.calls[0].onLoad(photoTexture)
    expect((target.sprite.material as THREE.SpriteMaterial).map).toBe(photoTexture)
  })
})
