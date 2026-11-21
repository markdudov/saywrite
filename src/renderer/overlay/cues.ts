// Audible cues generated with WebAudio; no sound files.
type Blip = { freq: number; type: OscillatorType }

function play(blips: Blip[], durMs: number): void {
  try {
    const ctx = new AudioContext()
    const gain = ctx.createGain()
    gain.gain.value = 0.08
    gain.connect(ctx.destination)
    const dur = durMs / 1000
    blips.forEach((b, i) => {
      const osc = ctx.createOscillator()
      osc.type = b.type
      osc.frequency.value = b.freq
      osc.connect(gain)
      osc.start(ctx.currentTime + i * dur)
      osc.stop(ctx.currentTime + (i + 1) * dur)
    })
    setTimeout(() => void ctx.close().catch(() => undefined), durMs * blips.length + 100)
  } catch {
    /* audio cues are best-effort */
  }
}

export const cues = {
  start: () =>
    play(
      [
        { freq: 660, type: 'sine' },
        { freq: 880, type: 'sine' }
      ],
      60
    ),
  stop: () =>
    play(
      [
        { freq: 880, type: 'sine' },
        { freq: 660, type: 'sine' }
      ],
      60
    ),
  // two 220 Hz triangle blips separated by a short gap
  error: () =>
    play(
      [
        { freq: 220, type: 'triangle' },
        { freq: 0, type: 'triangle' },
        { freq: 220, type: 'triangle' }
      ],
      70
    )
}
