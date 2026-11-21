import { expect, test } from 'vitest'
import { deepMerge } from '../../src/shared/deepMerge'

test('deepMerge merges objects, replaces arrays', () => {
  expect(deepMerge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] })).toEqual({
    a: { b: 1, c: 3 },
    l: [9]
  })
})

test('deepMerge does not mutate its inputs', () => {
  const base = { a: { b: 1 } }
  const out = deepMerge(base, { a: { b: 2 } })
  expect(base).toEqual({ a: { b: 1 } })
  expect(out).toEqual({ a: { b: 2 } })
})

test('deepMerge ignores prototype-polluting keys', () => {
  const out = deepMerge(
    {},
    JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":2}}')
  )
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  expect((out as Record<string, unknown>).polluted).toBeUndefined()
  expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  expect(Object.keys(out)).toEqual([])
})
