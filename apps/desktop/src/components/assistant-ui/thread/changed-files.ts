// Pure derivation for the assistant message's "N files changed" card: fold a
// turn's file-edit tool parts into one row per file. No React/DOM.

import {
  countDiffLineStats,
  fileEditBasename,
  fileEditPath,
  inlineDiffFromResult,
  isFileEditTool,
  parseMaybeObject
} from '@/components/assistant-ui/tool/fallback-model'
import { type ToolResultMetadata, toolResultRecord } from '@/lib/tool-result-metadata'

import { recordedSkillChanges } from './skill-changes'

export interface ChangedFile {
  added: number
  /** Basename, for the row label. */
  name: string
  /** Path exactly as the tool reported it (absolute or repo-relative). */
  path: string
  removed: number
}

export interface RecordedChangedFile extends ChangedFile {
  diffs: string[]
}

interface ChangedFilePart {
  toolResultMetadata?: ToolResultMetadata
  args?: unknown
  result?: unknown
  toolName?: unknown
  type?: unknown
}

interface TurnMessageLike {
  id?: string
  parts?: readonly unknown[]
  role?: string
}

/**
 * The changed-files card closes the newest turn, but the turn's tool calls can
 * live in earlier assistant bubbles than the final text bubble that hosts the
 * card. Walk back to the last user message and fold every assistant part in
 * that turn, not just the one part list on the card's own message.
 */
export function turnPartsForMessage(messages: readonly TurnMessageLike[], messageId: string): readonly unknown[] {
  const index = messages.findIndex(message => message.id === messageId)

  if (index < 0) {
    return []
  }

  let start = index

  while (start > 0 && messages[start - 1]?.role !== 'user') {
    start -= 1
  }

  const parts: unknown[] = []

  for (let i = start; i <= index; i += 1) {
    const message = messages[i]

    if (Array.isArray(message?.parts)) {
      parts.push(...message.parts)
    }
  }

  return parts
}

/**
 * One row per file the turn edited, in first-touched order, with the +/- of
 * every edit to that file summed. Only landed edits with a diff count: a call
 * still running has no result, and a failed one changed nothing.
 */
export function deriveChangedFiles(parts: readonly unknown[]): ChangedFile[] {
  return deriveRecordedChanges(parts).map(({ diffs: _diffs, ...file }) => file)
}

export function deriveRecordedChanges(parts: readonly unknown[]): RecordedChangedFile[] {
  const byPath = new Map<string, RecordedChangedFile>()

  for (const raw of parts) {
    const part = (raw ?? {}) as ChangedFilePart

    if (part.type !== 'tool-call' || typeof part.toolName !== 'string') {
      continue
    }

    const result = toolResultRecord(part)
    const diff = inlineDiffFromResult(result)

    if (!diff || result.success === false || result.error) {
      continue
    }

    let changes: RecordedChangedFile[]

    if (part.toolName === 'skill_manage') {
      changes = recordedSkillChanges(diff, parseMaybeObject(part.args))
    } else if (isFileEditTool(part.toolName)) {
      const path = fileEditPath(parseMaybeObject(part.args), result)
      changes = path ? [{ ...countDiffLineStats(diff), name: fileEditBasename(path), path, diffs: [diff] }] : []
    } else {
      continue
    }

    for (const file of changes) {
      const existing = byPath.get(file.path)

      if (existing) {
        existing.added += file.added
        existing.removed += file.removed
        existing.diffs.push(...file.diffs)
      } else {
        byPath.set(file.path, file)
      }
    }
  }

  return [...byPath.values()]
}
