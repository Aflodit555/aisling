# Aisling

An extensible AI Character Platform and Runtime.

Aisling is a long-term project to build a self-owned, extensible AI character
platform and runtime — not a single chatbot or a livestream-only app. Its
long-term experience direction takes Neuro-sama as one reference, and studies
[AIRI](https://github.com/moeru-ai/airi) as an engineering reference. Aisling is
**not** an AIRI fork and has no official relationship with either project.

> **Current version:** v0.1.6 · **Status:** early development. The architecture
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

Prerequisites: Node.js and pnpm.

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5174>.

Provider credentials are configured from the Settings UI — there is no `.env`
setup, and keys are never required in source code or the terminal.

## Layout

```
apps/stage-web   — Vue 3 + Vite Stage (/settings modules, /devtools)
packages/core    — framework-agnostic runtime: Stimulus, Character, Capability,
                   Provider, Output, PlatformConfig/ConfigStore, capability
                   registry, tool domain, and chat/speech/hearing/vision/search providers
```

## Configuration & key boundary

- `/settings/…` pages are the only place that inputs/displays credentials.
- All module settings share one `PlatformConfig` and one `ConfigStore`
  (`packages/core/src/config.ts`,
  `apps/stage-web/src/config/local-storage-config-store.ts`).
- API credentials configured in Settings are currently stored **locally in the
  browser** (`localStorage`). Do **not** commit your own real credentials.

## Commands

```bash
pnpm install     # install workspace
pnpm dev         # start the Stage dev server on http://localhost:5174
pnpm typecheck   # tsc (core) + vue-tsc (app)
pnpm test        # vitest (core)
pnpm build       # vite build (app)
```

Aisling runs on a fixed port **5174** so it can run alongside AIRI (5173).
