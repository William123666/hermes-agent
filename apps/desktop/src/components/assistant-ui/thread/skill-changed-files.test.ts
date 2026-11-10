import { describe, expect, it } from 'vitest'

import { toChatMessages, upsertToolPart } from '@/lib/chat-messages'

import { deriveRecordedChanges } from './changed-files'

const root = '/profiles/alpha/skills/ops/probe'

const skillDiff = `--- a/${root}/SKILL.md
+++ b/${root}/SKILL.md
@@ -1 +1 @@
-Old rule.
+New rule.
--- a/${root}/references/guide.md
+++ b/${root}/references/guide.md
@@ -0,0 +1,2 @@
+Guide.
+Example.
`

const part = (inline_diff = skillDiff, result: unknown = { success: true, operations_applied: 2 }) => ({
  type: 'tool-call',
  toolName: 'skill_manage',
  args: {
    operations: [
      { action: 'patch', name: 'probe' },
      { action: 'write_file', name: 'probe' }
    ]
  },
  result,
  toolResultMetadata: { inline_diff }
})

describe('skill edits in changed-files cards', () => {
  it('shows one recorded row per actual skill file, including supporting files', () => {
    expect(deriveRecordedChanges([part()])).toEqual([
      {
        path: `${root}/SKILL.md`,
        name: 'probe/SKILL.md',
        added: 1,
        removed: 1,
        diffs: [skillDiff.slice(0, skillDiff.indexOf(`--- a/${root}/references`)).trimEnd()]
      },
      {
        path: `${root}/references/guide.md`,
        name: 'probe/references/guide.md',
        added: 2,
        removed: 0,
        diffs: [skillDiff.slice(skillDiff.indexOf(`--- a/${root}/references`)).trimEnd()]
      }
    ])
  })

  it('merges repeated skill edits and normal file edits into the same summary', () => {
    const normal = {
      type: 'tool-call',
      toolName: 'patch',
      args: { path: '/repo/a.ts' },
      result: { success: true, diff: '--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+code' }
    }

    const files = deriveRecordedChanges([part(), part(), normal])
    expect(files).toHaveLength(3)
    expect(files[0]).toMatchObject({ added: 2, removed: 2 })
    expect(files[0]!.diffs).toHaveLength(2)
    expect(files[2]).toMatchObject({ name: 'a.ts', added: 1, removed: 0 })
  })

  it('never invents edits from args or from a failed/rolled-back operation', () => {
    expect(deriveRecordedChanges([part(''), part(skillDiff, { success: false, error: 'rolled back' })])).toEqual([])
  })

  it('does not mistake header-looking skill content for another changed file', () => {
    const diff = `--- a/${root}/SKILL.md\n+++ b/${root}/SKILL.md\n@@ -1 +1 @@\n--- a/fake\n+++ b/fake\n`
    expect(deriveRecordedChanges([part(diff)])).toMatchObject([{ path: `${root}/SKILL.md`, added: 1, removed: 1 }])
  })

  it('keeps the same skill files through live events and cold history hydration', () => {
    const completion = {
      name: 'skill_manage',
      tool_id: 'skill-call',
      args: part().args,
      result: part().result,
      inline_diff: skillDiff
    }

    const live = upsertToolPart([], completion, 'complete')

    const rows = [
      { role: 'user' as const, content: 'Update skill' },
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          {
            id: completion.tool_id,
            type: 'function' as const,
            function: { name: completion.name, arguments: JSON.stringify(completion.args) }
          }
        ]
      },
      {
        role: 'tool' as const,
        tool_call_id: completion.tool_id,
        name: completion.name,
        content: JSON.stringify(completion.result),
        display_metadata: JSON.stringify({ tool_result_metadata: { inline_diff: skillDiff } })
      }
    ]

    const cold = toChatMessages(rows).flatMap(message => message.parts)
    expect(deriveRecordedChanges(live)).toEqual(deriveRecordedChanges(cold))
    expect(deriveRecordedChanges(cold)).toHaveLength(2)
  })
})
