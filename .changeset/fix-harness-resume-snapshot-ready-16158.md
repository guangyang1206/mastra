---
"@mastra/core": patch
---

fix(harness): wait for suspended snapshot before resuming tool calls

When a tool is suspended, the `tool-call-suspended` stream chunk arrives
before the workflow engine has flushed the snapshot to the backing store.
Fast clients (e.g. custom harness routes that auto-resume) can therefore
call `handleToolResume` while the snapshot is still in flight, causing
`resumeStream` to find no matching tool call in the persisted message list.
The result is dropped and the `updateToolInvocation` warning fires.

Add a `waitForSuspendedSnapshot` helper that polls
`storage.workflows.getWorkflowRunById()` until the run status is
`suspended` or `waiting` (up to 5 s, 100 ms intervals). When no storage
is configured the poll is skipped immediately, keeping the in-memory /
SQLite fast path unchanged.

Fixes #16158
