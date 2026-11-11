import type { RecordedChangedFile } from './changed-files'

/** Split the backend's captured skill diff, never infer changes from requested operations. */
export function recordedSkillChanges(diff: string, args: Record<string, unknown>): RecordedChangedFile[] {
  const operations = Array.isArray(args.operations) ? args.operations : [args]

  const names = operations.flatMap(op =>
    op && typeof op === 'object' && typeof op.name === 'string' ? [op.name.replace(/\\/g, '/').split('/').pop()!] : []
  )

  const files: RecordedChangedFile[] = []
  const lines = diff.split('\n')
  let file: RecordedChangedFile | undefined
  let section: string[] = []
  let oldRemaining = 0
  let newRemaining = 0

  const flush = () => {
    if (file) {
      file.diffs = [section.join('\n').trimEnd()]
      files.push(file)
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (oldRemaining === 0 && newRemaining === 0 && line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      flush()
      const path = lines[i + 1]!.slice(4).replace(/^b\//, '')
      const segments = path.replace(/\\/g, '/').split('/')
      const skillIndex = segments.findLastIndex(segment => names.includes(segment))
      file = {
        path,
        name: segments.slice(skillIndex >= 0 ? skillIndex : -2).join('/'),
        added: 0,
        removed: 0,
        diffs: []
      }
      section = [line, lines[++i]!]

      continue
    }

    if (!file) {
      continue
    }

    section.push(line)
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)

    if (hunk) {
      oldRemaining = Number(hunk[2] ?? 1)
      newRemaining = Number(hunk[4] ?? 1)
    } else if (oldRemaining > 0 || newRemaining > 0) {
      if (line.startsWith('+')) {
        file.added++
        newRemaining--
      } else if (line.startsWith('-')) {
        file.removed++
        oldRemaining--
      } else if (line.startsWith(' ')) {
        oldRemaining--
        newRemaining--
      }
    }
  }

  flush()

  return files
}
