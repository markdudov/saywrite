// Generates placeholder tray icons (solid circle) with no dependencies.
// Final artwork arrives in Plan C. Run with `npm run icons`.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'tray')

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function circlePng(size, [r, g, b]) {
  const rows = []
  const c = (size - 1) / 2
  const radius = size / 2 - 1
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      const inside = Math.hypot(x - c, y - c) <= radius
      row.set(inside ? [r, g, b, 255] : [0, 0, 0, 0], 1 + x * 4)
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const icons = [
  // macOS template images (black + alpha; the system tints them)
  ['trayTemplate.png', 16, [0, 0, 0]],
  ['trayTemplate@2x.png', 32, [0, 0, 0]],
  // Windows / Linux
  ['tray.png', 32, [90, 90, 90]],
  ['tray-recording.png', 32, [220, 38, 38]]
]

mkdirSync(outDir, { recursive: true })
for (const [name, size, color] of icons) {
  writeFileSync(join(outDir, name), circlePng(size, color))
  console.log(`wrote resources/tray/${name}`)
}
