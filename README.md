# Aisling

An extensible AI Character Platform and Runtime.

Aisling is a long-term project to build a self-owned, extensible AI character
platform and runtime — not a single chatbot or a livestream-only app. Its
long-term experience direction takes Neuro-sama as one reference, and studies
[AIRI](https://github.com/moeru-ai/airi) as an engineering reference. Aisling is
**not** an AIRI fork and has no official relationship with either project.

> **Current version:** v0.2.9 · **Status:** early development. The architecture
> and public APIs may still change.

## What exists today

- Runtime foundation (Stimulus → Runtime → Character → Provider → Output)
- Character / Stimulus domain model
- Capability registry: Consciousness, Speech, Hearing, Vision, Web Search
- Provider Settings UI with per-module model onboarding (Test + Save)
- Multi-conversation persistence (localStorage)
- Browser / System Speech (`speechSynthesis`)
- Alibaba Native HTTP TTS
- Devtools event tracing

**Verified end-to-end:** Consciousness, Vision, Browser Speech, Alibaba TTS,
conversation persistence.

**Known limitations:** Hearing / Alibaba ASR is implemented but not yet fully
verified end-to-end against the real provider.

## Quick start

Prerequisites: Node.js and pnpm (Node.js 22.12+ for the Desktop host).

```bash
pnpm install
pnpm dev:desktop
```

`pnpm dev:desktop` is the single Desktop entry: it starts the Stage renderer
(Vite), waits until it is ready, launches Electron, and cleans the renderer
process up when Electron exits. No second terminal is required.

To run the Desktop against the **built** renderer instead of the dev server:

```bash
pnpm start:desktop
```

The plain browser Stage remains available for lightweight development:

```bash
pnpm dev
```

Open <http://localhost:5174>.

Configure providers inside the Electron window, then expand **Autonomous Speak**
in the conversation dock. It is off by default; the threshold defaults to 90
seconds with a 180-second cooldown. Desktop keyboard/mouse activity resets
silence. The ordinary browser Stage cannot read desktop activity.

See [Desktop host and data lifecycle](docs/desktop-host.md) and the
[autonomous speaking vertical slice](docs/autonomous-speaking.md).

Provider credentials are configured from the Settings UI — there is no `.env`
setup, and keys are never required in source code or the terminal.

## Layout

```
apps/stage-web   — Vue 3 + Vite Stage (/settings modules, /devtools)
apps/stage-desktop — minimal Windows Electron host (foreground app/title + idle IPC)
packages/core    — framework-agnostic runtime: Stimulus, Character, Capability,
                   Provider, Output, PlatformConfig/ConfigStore, capability
                   registry, tool domain, and chat/speech/hearing/vision/search providers
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
pnpm dev:desktop   # Desktop (primary): start renderer → wait ready → launch Electron
pnpm start:desktop # Desktop against the built renderer (aisling://stage)
pnpm dev           # browser Stage dev server on http://localhost:5174
pnpm typecheck     # tsc (core) + vue-tsc (app) + Electron JS checkJs
pnpm test          # vitest (core + Stage autonomous integration)
pnpm build         # vite build (app)
```

Aisling runs on a fixed port **5174** so it can run alongside AIRI (5173).
