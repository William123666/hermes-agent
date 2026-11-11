// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'

import { deriveRecordedChanges } from '@/components/assistant-ui/thread/changed-files'
import { toChatMessages } from './hydration'

describe('inspect real turn', () => {
  it('prints parts', () => {
    const rows = JSON.parse(readFileSync('/tmp/rows.json', 'utf8')) as Any[]
    const messages = toChatMessages(rows)
    for (const message of messages as Any[]) {
      console.log('FILES', deriveRecordedChanges(message.parts as Any[]).map(f => [f.name, f.added, f.removed]))
      console.log(
        'MSG',
        message.id,
        message.role,
        (message.parts as Any[]).map(part =>
          part.type === 'tool-call' ? `tool:${part.toolName}:result=${Object.hasOwn(part, 'result')}` : part.type
        )
      )
    }
  })
})
