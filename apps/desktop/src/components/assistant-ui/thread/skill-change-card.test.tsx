import { readFileSync } from 'node:fs'

import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { ReviewPane } from '@/app/right-sidebar/review'
import { type GatewayEventPayload, toChatMessages, upsertToolPart } from '@/lib/chat-messages'
import { toRuntimeMessage } from '@/lib/chat-runtime'
import { $reviewRecordedChanges } from '@/store/review'
import type { SessionMessage } from '@/types/hermes'

import { stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime } from '../test-utils'
import { Thread } from '../thread'

stubThreadEnvironment()
stubThreadViewportSize()

interface Receipt {
  rows: SessionMessage[]
  completion: GatewayEventPayload
}

const fixture: Receipt = {
  rows: [],
  completion: {
    name: 'skill_manage',
    tool_id: 'skill-edit',
    args: { operations: [{ name: 'probe', action: 'patch' }] },
    result: { success: true },
    inline_diff: '--- a//skills/probe/SKILL.md\n+++ b//skills/probe/SKILL.md\n@@ -1 +1 @@\n-before\n+after\n'
  }
}

const receipt: Receipt = process.env.SKILL_EDIT_RECEIPT
  ? JSON.parse(readFileSync(process.env.SKILL_EDIT_RECEIPT, 'utf8'))
  : fixture

if (!receipt.rows.length) {
  receipt.rows = [
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: receipt.completion.tool_id!,
          type: 'function',
          function: { name: 'skill_manage', arguments: JSON.stringify(receipt.completion.args) }
        }
      ]
    },
    {
      role: 'tool',
      name: 'skill_manage',
      tool_call_id: receipt.completion.tool_id!,
      content: JSON.stringify(receipt.completion.result),
      display_metadata: { tool_result_metadata: { inline_diff: receipt.completion.inline_diff } }
    }
  ]
}

afterEach(() => {
  cleanup()
  $reviewRecordedChanges.set([])
})

it.each(['live', 'cold'] as const)('%s skill card opens the actual recorded skill diff without Git', async source => {
  const messages =
    source === 'live'
      ? [
          {
            id: 'live-skill',
            role: 'assistant' as const,
            pending: false,
            parts: upsertToolPart([], receipt.completion, 'complete')
          }
        ]
      : toChatMessages(receipt.rows)

  const ui = render(
    <ThreadRuntime messages={messages.map(toRuntimeMessage)}>
      <Thread />
    </ThreadRuntime>
  )

  await waitFor(() => expect(ui.container.querySelector('[data-slot="aui_changed-files"]')).not.toBeNull())
  const card = ui.container.querySelector('[data-slot="aui_changed-files"]') as HTMLElement
  expect(card.textContent).toContain('SKILL.md')
  fireEvent.click(
    within(card)
      .getAllByRole('button')
      .find(button => button.textContent === 'Review')!
  )
  const changes = $reviewRecordedChanges.get()
  const expectedFiles = receipt.completion.inline_diff!.split('\n').filter(line => line.startsWith('+++ b/')).length
  expect(changes).toHaveLength(expectedFiles)
  expect(changes.every(file => file.name.includes('/'))).toBe(true)
  const pane = render(<ReviewPane />)

  for (const file of changes) {
    expect(pane.container.textContent).toContain(file.path.split('/').pop())
    expect(file.diffs.every(diff => diff.includes('@@'))).toBe(true)
  }
})
