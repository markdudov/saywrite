import path from 'node:path'

export interface AppPaths {
  settings: string
  modesDir: string
  vocabulary: string
  secrets: string
  recordingsDir: string
  historyDb: string
  logsDir: string
}

/** root = SAYWRITE_USER_DATA env (tests/e2e) or app.getPath('userData'); resolved by the caller. */
export function appPaths(root: string): AppPaths {
  return {
    settings: path.join(root, 'settings.json'),
    modesDir: path.join(root, 'modes'),
    vocabulary: path.join(root, 'vocabulary.json'),
    secrets: path.join(root, 'secrets.json'),
    recordingsDir: path.join(root, 'recordings'),
    historyDb: path.join(root, 'history.db'),
    logsDir: path.join(root, 'logs')
  }
}
