import { ModeSchema, type AppRef, type Mode } from '../schemas/mode'

export const BUILTIN_IDS = [
  'builtin-dictation',
  'builtin-clean',
  'builtin-message',
  'builtin-email',
  'builtin-prompt',
  'builtin-translate',
  'builtin-edit'
] as const

type Builtin = NonNullable<Mode['builtin']>

const INSTRUCTIONS = {
  clean:
    "Fix punctuation, capitalization and obvious grammar mistakes. Remove filler words (um, uh, like, you know, and their equivalents in the speaker's language), false starts and repeated words. Keep the speaker's wording, meaning and length; do not rephrase or summarize. Start a new paragraph only where the speaker clearly changes topic.",
  message:
    'Format as a short chat message in a friendly, natural tone. Fix punctuation and remove filler words. Keep it brief, with no greeting or sign-off unless spoken. No Markdown.',
  email:
    'Format as the body of an email in a clear, professional tone: a greeting line, short paragraphs, and a closing line if the speaker implied one. Fix grammar and remove filler words. Do not invent facts, names or commitments the speaker did not say. Do not add a subject line.',
  prompt:
    'Turn the speech into a clear, well-structured prompt for an AI assistant. State the goal first, then the relevant details, constraints and the expected output. Use short paragraphs or a bulleted list when it helps. Keep every requirement the speaker mentioned and do not add new ones.',
  translate: 'Translate faithfully and naturally. Fix punctuation and remove filler words.'
} as const

function make(
  builtin: Builtin,
  name: string,
  icon: string,
  order: number,
  patch: Partial<Pick<Mode, 'translateTo'>> & {
    instructions?: string
    selection?: boolean
    action?: Mode['output']['action']
  } = {}
): Mode {
  return ModeSchema.parse({
    schemaVersion: 1,
    id: `builtin-${builtin}`,
    name,
    icon,
    builtin,
    translateTo: patch.translateTo ?? null,
    ai: { enabled: patch.instructions !== undefined, instructions: patch.instructions ?? '' },
    context: { selection: patch.selection ?? false },
    output: { action: patch.action ?? 'paste' },
    order
  })
}

export function builtinModes(): Mode[] {
  return [
    make('dictation', 'Dictation', 'mic', 0),
    make('clean', 'Clean', 'sparkles', 1, { instructions: INSTRUCTIONS.clean }),
    make('message', 'Message', 'message-circle', 2, { instructions: INSTRUCTIONS.message }),
    make('email', 'Email', 'mail', 3, { instructions: INSTRUCTIONS.email }),
    make('prompt', 'Prompt', 'terminal', 4, { instructions: INSTRUCTIONS.prompt }),
    make('translate', 'Translate', 'languages', 5, {
      instructions: INSTRUCTIONS.translate,
      translateTo: 'en'
    }),
    make('edit', 'Edit', 'pencil', 6, {
      instructions: '',
      selection: true,
      action: 'replaceSelection'
    })
  ]
}

export const SUGGESTED_APPS: Record<'message' | 'email' | 'prompt', AppRef[]> = {
  message: [
    { name: 'Slack', macBundleId: 'com.tinyspeck.slackmacgap', winExeName: 'slack.exe' },
    { name: 'Microsoft Teams', macBundleId: 'com.microsoft.teams2', winExeName: 'ms-teams.exe' },
    { name: 'WhatsApp', macBundleId: 'net.whatsapp.WhatsApp', winExeName: 'WhatsApp.exe' },
    { name: 'Telegram', macBundleId: 'ru.keepcoder.Telegram', winExeName: 'Telegram.exe' },
    { name: 'Discord', macBundleId: 'com.hnc.Discord', winExeName: 'Discord.exe' },
    { name: 'Messages', macBundleId: 'com.apple.MobileSMS' }
  ],
  email: [
    { name: 'Mail', macBundleId: 'com.apple.mail' },
    { name: 'Outlook', macBundleId: 'com.microsoft.Outlook', winExeName: 'olk.exe' }
  ],
  prompt: [
    { name: 'VS Code', macBundleId: 'com.microsoft.VSCode', winExeName: 'Code.exe' },
    { name: 'Cursor', macBundleId: 'com.todesktop.230313mzl4w4u92', winExeName: 'Cursor.exe' },
    { name: 'Terminal', macBundleId: 'com.apple.Terminal' },
    { name: 'iTerm', macBundleId: 'com.googlecode.iterm2' },
    { name: 'Windows Terminal', winExeName: 'WindowsTerminal.exe' },
    { name: 'ChatGPT', macBundleId: 'com.openai.chat', winExeName: 'ChatGPT.exe' },
    { name: 'Claude', macBundleId: 'com.anthropic.claudefordesktop', winExeName: 'claude.exe' }
  ]
}
