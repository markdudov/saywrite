import { describe, expect, test } from 'vitest'
import { UiohookKey } from 'uiohook-napi'
import { KEY } from '../../src/shared/keys'
import {
  entriesFromSnapshot,
  snapshotFromEntries,
  stripHtmlMeta
} from '../../src/main/native/clipboardItems'

describe('KEY constants', () => {
  test('KEY constants match uiohook', () => {
    expect(KEY.AltRight).toBe(UiohookKey.AltRight)
    expect(KEY.Meta).toBe(UiohookKey.Meta)
    expect(KEY.Ctrl).toBe(UiohookKey.Ctrl)
    expect(KEY.Shift).toBe(UiohookKey.Shift)
    expect(KEY.V).toBe(UiohookKey.V)
    expect(KEY.C).toBe(UiohookKey.C)
    expect(KEY.Escape).toBe(UiohookKey.Escape)
    expect(KEY.Enter).toBe(UiohookKey.Enter)
  })
})

describe('clipboard item conversion', () => {
  test('snapshot round trip drops empty types and items', () => {
    const a = Uint8Array.from([1])
    const snap = snapshotFromEntries([
      [
        ['text/plain', a],
        ['text/html', null]
      ],
      [['x', null]],
      [['image/png', Uint8Array.from([2, 3])]]
    ])
    expect(snap).toEqual({ items: [{ 'text/plain': a }, { 'image/png': Uint8Array.from([2, 3]) }] })
    expect(entriesFromSnapshot(snap)).toEqual([
      [['text/plain', a]],
      [['image/png', Uint8Array.from([2, 3])]]
    ])
    expect(entriesFromSnapshot({ items: [{}] })).toEqual([])
  })

  test('stripHtmlMeta removes exactly one Chromium prefix, text/html only, byte-level', () => {
    const enc = (t: string): Uint8Array => new TextEncoder().encode(t)
    const dec = (b: Uint8Array): string => new TextDecoder().decode(b)
    const meta = "<meta charset='utf-8'>"
    // source app's own meta survives: Chromium prefix + legit meta + body -> legit meta + body
    expect(dec(stripHtmlMeta('text/html', enc(`${meta}${meta}<b>x</b>`)))).toBe(`${meta}<b>x</b>`)
    expect(dec(stripHtmlMeta('text/html', enc(`${meta}<b>x</b>`)))).toBe('<b>x</b>')
    expect(dec(stripHtmlMeta('text/html', enc('<b>x</b>')))).toBe('<b>x</b>')
    const raw = enc(`${meta}<b>x</b>`)
    expect(
      stripHtmlMeta('electron application/osclipboard;format="Apple HTML pasteboard type"', raw)
    ).toBe(raw)
    expect(stripHtmlMeta('text/plain', raw)).toBe(raw)
    const tail = Uint8Array.from([0xff, 0xfe, 0xc3, 0x28])
    const mixed = new Uint8Array([...enc(meta), ...tail])
    expect(Array.from(stripHtmlMeta('text/html', mixed))).toEqual(Array.from(tail))
  })
})
