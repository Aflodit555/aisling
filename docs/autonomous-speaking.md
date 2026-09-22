# Desktop Awareness

## Runtime chain

```text
Settings toggle
  → preload IPC
  → Electron main starts external/kernel_c/build/Release/kernel.exe 2
  → JSONL DesktopContext
  → SemanticJudge
  → should_interrupt probability
  → thin trigger
  → existing AutonomousStimulus / Character / ChatProvider / Speech
```

The setting defaults to OFF and is persisted in the existing `PlatformConfig` store.
Browser-only Stage shows the control as unavailable and never attempts desktop capture.

Electron main owns the native child process. Toggle OFF, window close, renderer teardown,
and app quit stop the process; OFF also aborts an in-flight semantic request. Raw desktop
text is kept only in memory and is passed to the character as ephemeral system context.

## Semantic judge

`desktop-judge.cjs` is the current `SemanticJudge` implementation. It calls TypeSafe
System One with `jev-latest`, reads `TYPESAFE_API_KEY`, and returns only:

```ts
{ shouldInterrupt: number }
```

The only question is `should_interrupt: { type: 'noul', ... }`. State contains
`focus.app`, `focus.title`, `screen_text`, `media`, `mic`, and `idle_time`.
The response must contain `answers.should_interrupt` with type `noul` and a finite
numeric `noul` probability in [0, 1]. Requests time out after 10 seconds; errors are
shown in Desktop Awareness and the next poll retries. Electron must inherit
`TYPESAFE_API_KEY` from its launching environment.

## Trigger

- Poll: 2 seconds
- `shouldInterrupt >= 0.65`
- Current bounded `app + title + full text + media + mic + idleSeconds` signature differs from the last trigger
- Existing runtime is ready and not generating a reply, processing vision, or speaking
- Cooldown: configured seconds (default 30, range 10–300)

Unchanged state is not judged repeatedly. Any judge input change, including idle time
or microphone activity, invalidates the cached decision. No planner, event bus,
semantic diff, or desktop memory is involved. Awareness persistence contains only
`enabled` and `cooldownSeconds`; obsolete fields are removed when loading settings.

## Temperature

Settings → Consciousness exposes `temperature` from 0.0 to 2.0 in 0.1 steps. The default
is 1.0. The value is stored in `PlatformConfig`, passed by `buildChatProvider`, and written
to the real OpenAI-compatible `/chat/completions` request body.

## Checks

```powershell
pnpm typecheck
pnpm test
pnpm build
node --test apps/stage-desktop/desktop-judge.test.cjs
pnpm dev # keep running in one terminal
pnpm --filter @aisling/stage-desktop test:smoke
pnpm --filter @aisling/stage-desktop test:smoke:prod
```

The desktop smoke uses the real kernel process and a local TypeSafe-protocol response. It
checks default OFF, start, context collection, judge scores, one existing-runtime message,
refresh restoration, temperature persistence, stop, and absence of a remaining process.
Use a real `TYPESAFE_API_KEY` for content-quality acceptance against Jev.
