import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { viewDirFromYawPitch } from './skyViewControls'

describe('viewDirFromYawPitch', () => {
  it('yaw 0, pitch 0 -> +X', () => {
    const out = new THREE.Vector3()
    viewDirFromYawPitch(0, 0, out)
    expect(out.x).toBeCloseTo(1, 10)
    expect(out.y).toBeCloseTo(0, 10)
    expect(out.z).toBeCloseTo(0, 10)
  })

  it('yaw pi/2, pitch 0 -> +Y', () => {
    const out = new THREE.Vector3()
    viewDirFromYawPitch(Math.PI / 2, 0, out)
    expect(out.x).toBeCloseTo(0, 10)
    expect(out.y).toBeCloseTo(1, 10)
    expect(out.z).toBeCloseTo(0, 10)
  })

  it('pitch ~90deg (clamp limit) -> ~+Z, camera.up convention', () => {
    const out = new THREE.Vector3()
    viewDirFromYawPitch(0, 1.52, out) // 1.52 rad ~= 87.1 deg, the clamp margin used elsewhere
    expect(out.z).toBeGreaterThan(0.99)
    expect(Math.abs(out.x)).toBeLessThan(0.06)
    expect(Math.abs(out.y)).toBeLessThan(0.06)
  })

  it('pitch negative -> -Z', () => {
    const out = new THREE.Vector3()
    viewDirFromYawPitch(0, -1.52, out)
    expect(out.z).toBeLessThan(-0.99)
  })

  it('always returns a unit vector', () => {
    const out = new THREE.Vector3()
    for (const yaw of [0, 1, -2.3, 4.5]) {
      for (const pitch of [-1.5, -0.5, 0, 0.5, 1.5]) {
        viewDirFromYawPitch(yaw, pitch, out)
        expect(out.length()).toBeCloseTo(1, 10)
      }
    }
  })

  it('returns the same object passed in (out param)', () => {
    const out = new THREE.Vector3()
    const ret = viewDirFromYawPitch(0.3, 0.2, out)
    expect(ret).toBe(out)
  })
})
