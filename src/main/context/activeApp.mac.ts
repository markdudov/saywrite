import { execFile } from 'node:child_process'
import type { AppRefNow } from './activeApp'

const LSAPPINFO = '/usr/bin/lsappinfo'
const TIMEOUT_MS = 1000

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(LSAPPINFO, args, { timeout: TIMEOUT_MS }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    )
  })
}

/** Parses `lsappinfo info -only name -only bundleID <asn>` output. */
export function parseLsappinfo(stdout: string): AppRefNow | null {
  const nameMatch = /^\s*"([^"]*)"\s+ASN:/m.exec(stdout)
  if (!nameMatch) return null
  const idMatch = /bundleID="([^"]*)"/.exec(stdout)
  return { name: nameMatch[1], id: idMatch ? idMatch[1] : '' }
}

export async function getActiveAppMac(): Promise<AppRefNow | null> {
  try {
    const front = await run(['front'])
    const asn = /ASN:\S+?:/.exec(front)?.[0]
    if (!asn) return null
    const info = await run(['info', '-only', 'name', '-only', 'bundleID', asn])
    return parseLsappinfo(info)
  } catch {
    return null
  }
}
