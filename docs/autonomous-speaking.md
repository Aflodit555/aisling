# Desktop Awareness

The active target/identity/cache/temporal design is [Desktop Situation Understanding P1](./desktop-situation.md). [Local diagnostics](./desktop-diagnostics.md) explains development flags and manual testing.

[Phase-one Context](./context-phase-one.md) describes the shared session history, token window and bounded evidence attached only to delivered speech. Autonomous generation remains candidate-only; this is separate from Jev's optional target reply summaries.

Renderer polls every two seconds through preload/IPC. Kernel receives a stdin sequence and reports current foreground UIA plus system media, mic, idle and headphones; foreground hook only updates HWND. Main caps fields and rejects unavailable reads rather than substituting cached context. Native capture limits are unchanged.

A bounded target candidate reaches Jev (jev-latest, TypeSafe System One), then the existing Character Runtime/ChatProvider. Jev has a ten-second deadline and strict should_interrupt noul probability validation. Threshold remains 0.65. Quiet disables autonomous capture/judgment. Local duplicate, ready and busy gates run before Jev; threshold and configured cooldown run before generation. Normal user questions remain independent.

Cooldown defaults to 30 seconds (10–300 in settings), applies across sources/windows and starts at trigger and completion. Failed/empty/revoked results release reservation after cooldown. Same candidate is not permanently prohibited; finite retention and later idle episodes define reopening. Raw idle growth does not invalidate an equivalent judgment.

Awareness is OFF by default. Browser Stage does not collect desktops. OFF aborts collection and an in-flight Jev request. Media requests are revalidated before Chat and delivery; foreground changes do not unconditionally cancel accepted replies.

Settings retain enabled/cooldownSeconds/jevApiKey/replyHistoryEnabled. The old history-consent key migrates once. Reply summaries are optional and bound to response targets, not to an unrelated foreground window. Default temperature remains 1.0, adjustable 0–2 and passed to the OpenAI-compatible request.

Checks: pnpm -r run typecheck; pnpm test; pnpm build; node --test apps/stage-desktop/desktop-activity.test.cjs apps/stage-desktop/desktop-judge.test.cjs apps/stage-desktop/desktop-diagnostics.test.cjs. Optional native candidate smoke uses AISLING_DESKTOP_CANDIDATE_SMOKE=1 with production smoke and Mock model responses, requiring a stable accessible foreground or unambiguous media target.
