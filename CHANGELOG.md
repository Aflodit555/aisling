# Changelog

## v0.3.9 — 2026-11-12

Memory's first engineering baseline, collecting P0–P7.1 without a new database
schema/protocol version or dependency upgrade.

- Use Note-only Memory v2 for new and verified migrated Desktop profiles, with
  source-checked Evidence, Revision, Receipt, durable erasure and crash recovery.
- Add opt-in autonomous organization and typed Note Network evolution, conflict,
  supplementation and lateral ASSOCIATED_WITH navigation.
- Add optional DashScope embeddings, prepared Windows HNSW / bounded exact
  fallback, BM25 / metadata / vector RRF fusion and bounded two-hop recall.
- Align Vite and built Desktop authority, profile isolation and Worker resources;
  fix Stage startup with absent legacy memory and deterministic UI smoke checks.
- Consolidate historical documentation and keep private research/profile data
  outside source publication. Preserve legacy compatibility and migration paths.

Engineering tests do not establish long-term semantic or final-answer benefit.
P7.1's graph/embedding comparison limitations, damaged persistent-HNSW recovery,
and installer/signing/redistribution acceptance remain explicit limitations.
See [release notes](docs/release-v0.3.9.md) and
[validation](docs/release-v0.3.9-validation.md). No installer or GitHub Release
page is created by this source baseline.

## v0.3.7 — 2026-10-27

This release collects the implementation after v0.3.6 without changing the storage version or redesigning character behavior.

- Add opt-in asynchronous Reflection Formation: bounded batches, validated source references, independent persistence, cancellation and failure isolation.
- Add local Reflection Recall alongside original history Recall, with completed-state filtering, source revalidation, safe projection, per-turn snapshots and separate budgets.
- Keep Memory enabled by default while preserving saved opt-outs. Formation defaults off; disabling it preserves access to existing valid reflections. Disabling Memory stops both Recall sources and Formation.
- Preserve actual append times on new messages, keep legacy dates unknown, and present supported cross-session chronology without changing relevance selection or inventing event dates.
- Retain Context history priorities and tool-round boundaries. Scope ordinary-chat thinking compatibility to its existing exact provider/model route.
- Harden speech cancellation, actual playback state, stream cleanup and browser speech completion; preserve Desktop, Live2D and autonomous delivery boundaries.
- Remove obsolete experimental timing plumbing, consolidate operating documentation and retain useful research limitations separately. Verify the existing workspace lockfile without dependency upgrades.

Verification and audit details: [v0.3.7 release audit](docs/release-v0.3.7.md). Real-provider evidence is limited to small historical samples, not broad semantic or hardware acceptance. This is a source release; no installer, signing or automatic update support is introduced.

## v0.3.6

Published baseline for cross-session Memory Recall. Subsequent documentation corrections remain in Git history; this release does not rewrite them.
