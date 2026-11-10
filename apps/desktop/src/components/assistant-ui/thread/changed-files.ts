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
