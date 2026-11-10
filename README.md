# Aisling

An extensible AI Character Platform and Runtime.

Aisling is a long-term project to build a self-owned, extensible AI character
platform and runtime — not a single chatbot or a livestream-only app. Its
long-term experience direction takes Neuro-sama as one reference, and studies
[AIRI](https://github.com/moeru-ai/airi) as an engineering reference. Aisling is
**not** an AIRI fork and has no official relationship with either project.

> **Current version:** v0.3.7 · **Status:** early development. The architecture
> and public APIs may still change.

## What exists today

- Runtime foundation (Stimulus → Runtime → Character → Provider → Output)
- Character / Stimulus domain model
- Settings pages: General, Consciousness, Speech, Vision, Web Search, Memory, Desktop Awareness
- Provider Settings UI for model configuration
- Unified interaction history within each conversation session, with switching
  and restart recovery (localStorage in the browser; file-backed on Desktop)
- Context: a bounded, estimated-token history window; user replies can
  follow up on delivered autonomous speech and its compact, redacted trigger
  evidence, without extra Context LLM calls
- Memory: optional cross-session recall from local conversation history,
  with bounded evidence, user-topic anchors for short follow-ups, and distinct
  sources for user reports, stored replies and delivered autonomous speech
- Note-only memory for new Desktop profiles: opt-in background proposals,
  explicit approval, and local recall backed by original messages
- Previous-format profiles can check, keep eligible blocked records in history, and confirm a verified upgrade in Memory settings
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
- Alibaba HTTP and realtime streaming TTS
- Live2D idle life (blinks, gaze, posture) and Jev-judged emotion with a stabilizing state machine ([docs/emotion.md](docs/emotion.md))

Verification distinguishes automated Mock coverage, Electron smoke tests and
limited real-provider samples; see [release notes](CHANGELOG.md) and
[research results](docs/research/memory-validation.md).

**Memory** in Settings controls cross-session excerpts and starts on for new
profiles. On the built Desktop Stage, new and upgraded profiles use Note v2.
**Formation** can use the configured model to propose Notes after delivered
conversations. New proposals require native approval before writing. **Recall**
allows relevant, approved Notes to accompany ordinary text requests. Both child
switches start off for new profiles. Recall uses local lexical retrieval, and
the current conversation gets budget first.

A Note preserves its basis, uncertainty and any supported event time. The
application rechecks original messages before it exposes a Note for recall.
Storage and message timestamps describe records, and event time describes the
reported event. Historical semantic quality on real models still needs validation.

For existing profiles, **Memory → Check previous memories** checks what can be
upgraded. Confirming an eligible upgrade preserves verified current memories
and switches to v2 after validation. Historical operations remain subject to
source deletion. Profiles with unresolved evidence or history keep their old
authority or show that an interrupted upgrade needs to resume. See the
[P5 retirement report](docs/memory-note-only-p5-retirement.md).

Design and limits:
[Memory Recall](docs/memory.md),
[Context and persistence](docs/context-phase-one.md), and
[P2 preview](docs/p2-minimal-loop.md).

## Quick start

Prerequisites: Node.js and pnpm (Node.js 22.12+ for the Desktop host).

```bash
pnpm install --frozen-lockfile
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
and its dependencies. The Vite launch uses the legacy development path. Use the
built Stage to exercise Note v2 or migrate a profile, and use a separate
development profile if you also need the Vite launch.

Prepare the local Memory Worker with
[`scripts/prepare-memory-database.ps1`](scripts/prepare-memory-database.ps1)
before using the built Stage's Note operations. The source checkout checks
that the default `.local/memory-database` Worker scripts and manifests match
the checkout before spawning the Worker. See [Memory](docs/memory.md) for
safe refresh steps.

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
pnpm install --frozen-lockfile # install locked workspace dependencies
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
