import type { RecordedChangedFile } from '@/components/assistant-ui/thread/changed-files'
import { FileDiffPanel } from '@/components/chat/diff-lines'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DiffCount } from '@/components/ui/diff-count'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { $reviewRecordedChanges, $reviewScope, closeReview, refreshReview } from '@/store/review'

import { SidebarPanelLabel } from '../../shell/sidebar-label'
import { RightSidebarSectionHeader } from '../index'

export function RecordedReviewPane({ files }: { files: RecordedChangedFile[] }) {
  const { t } = useI18n()
  const c = t.statusStack.coding

  return (
    <aside
      aria-label={c.review}
      className="flex h-full min-w-0 flex-col overflow-hidden bg-(--ui-sidebar-surface-background) pt-(--titlebar-height)"
    >
      <RightSidebarSectionHeader>
        <SidebarPanelLabel>{t.assistant.thread.filesChanged(files.length)}</SidebarPanelLabel>
        <Button aria-label={c.close} onClick={closeReview} size="icon-xs" variant="ghost">
          <Codicon name="close" size="0.8125rem" />
        </Button>
      </RightSidebarSectionHeader>
      <div className="px-2 pb-1.5">
        <Button
          onClick={() => {
            $reviewRecordedChanges.set([])
            $reviewScope.set('uncommitted')
            void refreshReview()
          }}
          size="sm"
          variant="ghost"
        >
          {c.scopeUncommitted}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {files.map(file => (
          <section key={file.path}>
            <div className="flex items-center gap-2 py-2 text-(--ui-text-secondary)">
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={displayPath(file.path)}>
                {displayPath(file.path)}
              </span>
              <DiffCount added={file.added} removed={file.removed} />
            </div>
            {file.diffs.map((diff, index) => (
              <FileDiffPanel className="mx-0" diff={diff} key={index} path={file.path} />
            ))}
          </section>
        ))}
      </div>
    </aside>
  )
}
