# Changelog

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
