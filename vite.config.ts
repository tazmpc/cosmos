import { defineConfig } from 'vitest/config'

export default defineConfig({
  // relative base so the app works at any hosting path (e.g. GitHub Pages /cosmos/)
  base: './',
  test: { environment: 'node' },
})
