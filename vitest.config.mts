import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/{shared,main,renderer}/**/*.test.{ts,tsx}'],
    environment: 'node'
  }
})
