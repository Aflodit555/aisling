# Aisling

An extensible AI Character Platform and Runtime.

Aisling is a long-term project to build a self-owned, extensible AI character
platform and runtime — not a single chatbot or a livestream-only app. Its
long-term experience direction takes Neuro-sama as one reference, and studies
[AIRI](https://github.com/moeru-ai/airi) as an engineering reference. Aisling is
**not** an AIRI fork and has no official relationship with either project.

> **Current version:** v0.3.6 · **Status:** early development. The architecture
> and public APIs may still change.

## What exists today

- Runtime foundation (Stimulus → Runtime → Character → Provider → Output)
- Character / Stimulus domain model
- Settings pages: General, Consciousness, Speech, Vision, Web Search, Memory, Desktop Awareness
- Provider Settings UI for model configuration
- Unified interaction history within each conversation session, with switching
  and restart recovery (localStorage in the browser; file-backed on Desktop)
- Context Phase One: a bounded, estimated-token history window; user replies can
  follow up on delivered autonomous speech and its compact, redacted trigger
  evidence, without extra Context LLM calls
- Memory Phase One: optional cross-session recall from local conversation history,
  with bounded evidence, user-topic anchors for short follow-ups, and distinct
  sources for user reports, stored replies and delivered autonomous speech
- Persistence hardening: unsaved history stays in memory with a visible warning;
  Desktop writes replace the stored file only after a temporary write succeeds
- Desktop Situation Understanding P1/P1.1: explicit foreground/media candidates,
  bounded observation continuity, target-bound Jev judgment and Chat generation,
  media freshness checks and successful-delivery attribution
- Explicit interaction preference commands (`/quiet`, `/normal`, `/invited`)
- P2 short-term situation understanding preview, off by default: bounded,
  scoped understanding from foreground evidence via the existing Chat Provider;
  replies only consume ready understanding and never wait for its update
- Browser / System Speech (`speechSynthesis`)
- Alibaba Native HTTP TTS
- Live2D idle life (blinks, gaze, posture) and Jev-judged emotion with a stabilizing state machine ([docs/emotion.md](docs/emotion.md))

**Verified end-to-end:** Consciousness, Vision, Browser Speech, Alibaba TTS,
conversation persistence.

**v0.3.6:** ships the Memory Phase One recall foundation. Open **Settings → Memory**
and enable **cross-session recall** to use it. It is off by default, and the choice
is saved locally across restarts. Enabling it allows relevant excerpts from older
local sessions to be sent to your selected LLM Provider with user text turns.
Turning it off stops cross-session retrieval for new turns; it does not erase
existing conversations or retract requests already sent.

Memory uses local lexical retrieval, up to five sessions and a bounded evidence
block, without an extra LLM call. It can supply related experiences, corrections
and state changes for the model to interpret. It can also miss relevant sessions,
include unrelated excerpts or produce an incorrect recollection. Ordinary stored
messages have no individual timestamps: session update times are not event dates,
and missing dates must remain unknown. Stored assistant statements prove what was
said, not that an external action or fictional story really happened.

Context selects recent history within the active session. Memory retrieves from
other saved sessions. P2 maintains optional, bounded short-term desktop
understanding and may make separate background model calls. Memory does not add
automatic memory formation, a knowledge database or a complete long-term memory
system. Token counts are estimates; full persisted history can still reach
storage limits. P2 remains a preview, and the optional native Candidate smoke
remains inconclusive.

Design and limits:
[Memory Phase One](docs/memory.md),
[Context Phase One](docs/context-phase-one.md),
[Context Hardening](docs/context-hardening.md), and
[P2 preview](docs/p2-minimal-loop.md).

## Quick start

Prerequisites: Node.js and pnpm (Node.js 22.12+ for the Desktop host).

```bash
pnpm install
pnpm dev:desktop
```

`pnpm dev:desktop` is the current default for development and desktop testing:
it starts the Stage renderer (Vite), waits until it is ready, launches Electron,
and cleans the renderer process up when Electron exits. Code changes can update
the running UI. No second terminal is required.

To test the Desktop as a **built application**, closer to how a future
distributed app would run:

```bash
pnpm start:desktop
```

This command builds the renderer first, then launches Electron without the Vite
server. Run it again after changing code. It still requires this source checkout
and its dependencies; it does not create an installer or mean the app is a stable
release. Both Desktop modes share saved settings and conversations and are
intended to offer the same features; both paths need their own verification.

**Naming note:** `pnpm start` currently aliases `pnpm dev:desktop`, not
`pnpm start:desktop`.

The plain browser Stage remains available for lightweight development:

```bash
pnpm dev
```

Open <http://localhost:5174>.

Configure Consciousness and the Jev key in Settings, then enable **Desktop
Awareness**. It is off by default. The renderer polls every two seconds; an
eligible foreground or media candidate goes through Jev, the 0.65 score boundary
and a global cooldown (30 seconds by default, configurable from 10–300).
Idle can offer a finite opportunity; elapsed silence alone is not the trigger.
The ordinary browser Stage cannot read desktop activity.

See [Desktop host and data lifecycle](docs/desktop-host.md) and the
[Desktop Situation Understanding](docs/desktop-situation.md) and
[local diagnostics](docs/desktop-diagnostics.md).

Provider credentials are configured from the Settings UI — there is no `.env`
setup, and keys are never required in source code or the terminal.

## Layout

```
apps/stage-web   — Vue 3 + Vite Stage (/settings modules)
apps/stage-desktop — Windows Electron host, native snapshot IPC, Jev and storage
packages/core    — framework-agnostic runtime: Stimulus, Character, Capability,
                   Provider, Output, PlatformConfig/ConfigStore, tool domain,
                   and chat/speech/vision/search providers
external/kernel_c — pinned native Windows collector (UIA, media, mic, idle, audio device)
```

## Configuration & key boundary

- `/settings/…` pages are the only place that inputs/displays credentials.
- All module settings share one `PlatformConfig` and one `ConfigStore`
  (`packages/core/src/config.ts`,
  `apps/stage-web/src/config/local-storage-config-store.ts`).
- In the browser, credentials configured in Settings are stored in `localStorage`.
  In Electron they are routed through a thin bridge to one stable file in the
  Electron userData directory (`aisling-store.json`), so Desktop data is not tied
  to the renderer origin. Do **not** commit your own real credentials.

## Commands

```bash
pnpm install       # install workspace
pnpm dev:desktop   # development / current desktop testing, with live UI updates
pnpm start         # alias for pnpm dev:desktop
pnpm start:desktop # build first → launch built Desktop; no Vite server or installer
pnpm dev           # browser Stage dev server on http://localhost:5174
pnpm typecheck     # tsc (core) + vue-tsc (app) + Electron JS checkJs
pnpm test          # vitest (core + Stage autonomous integration)
pnpm build         # vite build (app)
node --test apps/stage-desktop/*.test.cjs # Desktop bridge/judge/diagnostic regressions
cmake --build external/kernel_c/build --config Release # native collector
```

The development server runs on fixed port **5174** so it can run alongside AIRI
(5173). The built Desktop uses `aisling://stage` instead.

After cloning, initialize the native submodule with `git submodule update --init`
and build it using the Windows C++23/MSVC instructions in
[Desktop host](docs/desktop-host.md). The native executable is not committed.

The user reports preliminary P1/P1.1 desktop acceptance was good; automated tests
use Mock models and do not establish full semantic situation understanding.
Current limits and verification results are recorded in
[the P1.1 baseline report](docs/p1.1-baseline.md).
