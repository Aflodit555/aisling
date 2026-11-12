# Aisling

An extensible AI Character Platform and Runtime.

Aisling is a long-term project to build a self-owned, extensible AI character
platform and runtime — not a single chatbot or a livestream-only app. Its
long-term experience direction takes Neuro-sama as one reference, and studies
[AIRI](https://github.com/moeru-ai/airi) as an engineering reference. Aisling is
**not** an AIRI fork and has no official relationship with either project.

> **Current version:** v0.3.9 · **Status:** Memory engineering baseline. The architecture
> and public APIs may still change.

See the [v0.3.9 release notes](docs/release-v0.3.9.md) and
[release validation](docs/release-v0.3.9-validation.md). This baseline does not
establish long-term semantic benefit or readiness for installer distribution.

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
- Note-only memory for new Desktop profiles: opt-in autonomous organization,
  source-constrained lifecycle operations, typed Note links and local recall backed by original messages
- Optional DashScope embeddings with local BM25 / metadata / vector RRF fusion,
  bounded two-hop associative recall, and Windows HNSW with an exact-search fallback
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
profiles. In Desktop, new and upgraded profiles use Note v2.
**Formation** can use the configured model to propose Notes after delivered
conversations. Source-checkable operations can be saved automatically; uncertain proposals retain native review. **Recall**
allows relevant, approved Notes to accompany ordinary text requests. Both child
switches start off for new profiles. Note Recall combines local BM25 and metadata
with optional query embeddings and bounded Note Network expansion. The current
conversation gets budget first; Notes remain limited to three items / 2000 characters.

Embedding configuration lives in Memory settings. Formation can build document
vectors and run bounded background relationship checks through the configured
Provider (at most eight checks per hour, at least 60 seconds apart). Similarity
only supplies candidates; it does not establish a relationship or factual support.
The prepared Windows Worker supports HNSW when its pinned native dependencies
are present; new stores can fall back to bounded exact search. A damaged runtime
with an existing HNSW index must be repaired before writes or deletion can be
assumed to work.

The engineering loop has automated coverage, but additional lateral recall and
final-answer benefit are **not established**. P7.1's original comparison had no
effective graph and unequal embedding fallback conditions; its small later
relation sample does not establish general semantic quality. See the
[P7.1 validation and limits](docs/memory-p7-1-validation.md).

A Note preserves its basis, uncertainty and any supported event time. The
application rechecks original messages before it exposes a Note for recall.
Storage and message timestamps describe records, and event time describes the
reported event. Historical semantic quality on real models still needs validation.

For existing profiles, **Memory → Check previous memories** checks what can be
upgraded. Confirming an eligible upgrade preserves verified current memories
and switches to v2 after validation. Historical operations remain subject to
source deletion. Profiles with unresolved evidence or history keep their old
authority or show that an interrupted upgrade needs to resume. See the
[Memory migration and compatibility notes](docs/memory.md).

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
it starts the Stage renderer (Vite) on localhost port 5174, waits for that
process to listen, then starts Electron. Code changes can update the running
UI. By default it uses `.local/desktop-dev-profile` for both app and browser
session data.

To test the Desktop as a **built application**, closer to how a future
distributed app would run:

```bash
pnpm start:desktop
```

This command builds the renderer first, then launches Electron without the Vite
server. Run it again after changing code. It still requires this source checkout
and its dependencies. It uses the normal Electron profile. Both Desktop
commands apply the same Memory authority rules. To test an existing isolated
profile with Vite, set `AISLING_DEV_PROFILE` to its absolute directory. Both
launch modes take the same exclusive lock when pointed at the same profile.

Prepare the local Memory Worker with
[`scripts/prepare-memory-database.ps1`](scripts/prepare-memory-database.ps1)
before using Desktop Note operations. Run the script without arguments to
refresh an existing installation and reuse its pinned runtime and dependencies.
The source checkout checks
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

Memory persistence runs in an isolated Windows Node 24.12.0 Worker with
LadybugDB 0.22.1. Main owns authority, authorization and recovery; the Worker owns
transactional Note / Evidence / Revision / Receipt storage, Note links and vectors.
Stage Web owns settings, Provider execution and final recall projection; Core owns
Context and request budgets. Old Reflection modules remain for legacy profiles,
migration and source erasure, not as a second v2 write authority.

Use the [documentation index](docs/README.md) for current guides and historical
research. Private raw research bundles in `reports/`, local profiles, Worker
resources and generated artifacts are excluded from source publication.

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
node --test --test-concurrency=1 apps/stage-desktop/*.test.cjs # Desktop regressions
cmake --build external/kernel_c/build --config Release # native collector
```

The development server runs on fixed port **5174** so it can run alongside AIRI
(5173). The built Desktop uses `aisling://stage` instead.

`pnpm test` runs Core and Stage Web; Desktop native tests need a separate run.
For the full Desktop suite, set `AISLING_MEMORY_DB_P0_TEST_RESOURCES` to the
absolute prepared Worker directory before running the command above. Without it,
native and Electron tests are skipped. Run serially: the default Worker resource
startup lock deliberately rejects concurrent starts. Tests use synthetic profiles
and Mock providers; their success is not real-provider semantic acceptance.

After cloning, initialize the native submodule with `git submodule update --init`
and build it using the Windows C++23/MSVC instructions in
[Desktop host](docs/desktop-host.md). The native executable is not committed.

The user reports preliminary P1/P1.1 desktop acceptance was good; automated tests
use Mock models and do not establish full semantic situation understanding.
Current limits and verification results are recorded in
[the P1.1 baseline report](docs/p1.1-baseline.md).
