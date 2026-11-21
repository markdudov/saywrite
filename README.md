# Saywrite

**Voice dictation that writes the way you would. Windows and Mac. Pay once. Your keys, your data.**

> **Status: in development.** Nothing is ready to install yet. Follow the repository to see it being built.

Press a hotkey, speak, and well-formatted text appears in whatever app you are typing in.
Optional AI *modes* rewrite what you said for the situation: a clean note, a chat message, an email,
a clear prompt for an AI tool, a translation, or an edit of the text you selected.

## Why Saywrite

- **No account, no subscription, no vendor cloud.** You bring your own API keys (OpenAI, Anthropic,
  Google Gemini, Groq, Deepgram, ElevenLabs, OpenRouter, or any OpenAI-compatible endpoint such as
  Ollama), or dictate fully offline with a local Whisper model.
- **Modes that understand context.** Each mode has its own instructions, language and models, can use
  the active app, your selected text or the clipboard as context, and can switch on automatically in
  the apps you choose.
- **Never lose what you said.** Audio is saved before anything is sent; failed dictations can be retried.
- **Transparent costs.** See the estimated cost of every dictation and each month, per provider.
- **Open source.** GPL-3.0. Build it yourself for free, or buy the signed, auto-updating build to
  support development.

## Planned platforms

macOS 13+ (Apple Silicon and Intel) and Windows 10/11 (x64).

## Documentation

- [Design](docs/specs/2026-11-21-saywrite-design.md)
- [Implementation plan, part A: core dictation](docs/plans/2026-11-21-saywrite-plan-a-core.md)

## License

The source code is licensed under the [GNU General Public License v3.0 or later](LICENSE).

The **Saywrite** name and logo are not covered by the GPL. If you distribute a modified version,
please give it a different name and logo.
