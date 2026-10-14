# Desktop Situation Understanding P1/P1.1

P1 replaces Observation Continuity v0.1 and the foreground Event handled/history association. There is one live path, with no old Event adapter. It provides program-level response targets, not semantic event understanding or proof of the model's eventual topic.

## Production path

```text
Renderer poll -> native composite Snapshot
  -> bounded desktop observations: object + content version
  -> one explicit candidate (source / objectId / id / change / target / snapshot)
  -> local duplicate / ready / busy gates
  -> Jev(candidate target, environment, optional same-target recent reply)
  -> 0.65 threshold / global cooldown
  -> media-only fresh capture before Chat
  -> Chat(same candidate target; no competing desktop or ordinary history)
  -> media-only fresh capture before delivery
  -> successful displayed/persisted text marks that candidate handled
```

Core contract: packages/core/src/stimulus.ts. Pure identity/selection and the bounded registry: apps/stage-web/src/runtime/desktop-observations.ts. Scheduling and gates: autonomous.ts. Main validates the candidate against its capture before Jev. Stage owns display and explicit cancellation. Native collection contents/limits, ordinary conversation, Persona, Speech, Live2D and Emotion retain their existing responsibilities. Native report now explicitly finishes potentially slow UIA/audio-device reads before querying Playing media last, reducing stale media in a newly completed capture. Its startup/fallback path also checks the existing own-PID exclusion, preventing the companion’s own conversation from becoming screen input when no real external target exists.

## Objects, versions and changes

- Foreground object identity is app + HWND. Its content version is full bounded title + normalized UIA SHA-256 fingerprint. This separates a continuing container from changing content. Empty/untrusted samples do not manufacture fresh IDs.
- The registry remembers up to 32 recent versions, expires unobserved entries after 10 minutes, evicts least recently seen unreserved entries and protects in-flight reservations. A sampled Chrome -> QQ -> Chrome return finds the old handled version. The same window loading different sampled content creates a different candidate under the same object.
- P1.1: revisions in an already known foreground object need two consecutive fresh captures of the exact title/text fingerprint, at most 30 seconds apart, before judgment. First appearance of a new object keeps the existing immediate opportunity. Empty samples, interruptions, window/title switches and capture gaps reset the stability probe. This filters transient readings, not stable toolbar changes or semantic duplicates.
- Foreground versions also carry a bounded app/HWND/title key, which is a reading-context scope, not verified document identity. Successful delivery marks only its accepted version handled, and supersedes all already observed pending versions in that scope, including versions sampled during generation. Once that scope has a successful delivery, leaving it retires pending versions; a newer stable pending version also supersedes older pending versions. Superseded records lose cached scores, retain null delivery time and cannot reopen through a window return or idle. Reserved turns remain protected. New titles and future stable unseen content remain eligible; failures do not consume other versions. These rules work with recent reply history disabled.
- Media identity is normalized app + trimmed title + artist. Exact duplicate sessions collapse; enumeration order is irrelevant. Any incomplete metadata or more than one distinct Playing identity is unknown. Only one identity observed in two consecutive fresh captures (gap at most 30 seconds) becomes a media candidate.
- A foreground app that owns a current or recently observed media session supplies UIA as background, not separate content opportunities. Therefore lyrics/title churn does not create song opportunities, including short session dropouts. This is generic app ownership, not a rule for one player.
- Selection prioritizes a new stable media candidate, then a new independent foreground candidate. Handled/reserved versions are duplicates. A previously handled track may reopen after a confirmed stable different track and at least five minutes since its reply; uninterrupted playback or a short ambiguous/dropout interval does not reopen it. Raw media changes do not reopen an unchanged foreground version.
- Raw idle increments do not affect the judgment cache. One crossing into 60-second idle can offer an unhandled foreground target again after a decline. A handled target can reopen only in a later idle episode, at least five minutes after its reply. Continuous idle alone does not renew it. Thus suppression is finite rather than a permanent content blacklist.
- Mic state is environment. It can invalidate the score for an unhandled candidate but does not create a new content version.

## Target, cache and history

Candidate ID binds a response opportunity/version; objectId binds its observation container/track. Candidate.source and change describe deterministic program attribution. They are not a semantic choice emitted by Jev.

AutonomousStimulus carries only this candidate. The composite snapshot is consumed by observation selection, environment judgment and freshness validation; it is not retained as an unused Chat payload. Candidate snapshot contains only capture metadata. Cached scores belong to the observation; the controller does not maintain a second score/context copy. `foregroundScope` names the app/HWND/title lifecycle key without claiming a semantic page identity.

Jev still returns only shouldInterrupt and uses the same 0.65 boundary. Its state contains candidate.target, mic/idle category as background and optionally recent_reply for that target. It no longer receives competing screen text/media or current_event. Each bounded observation owns its judgment cache, keyed by candidate ID, mic state and consented recent reply; returning to an unchanged declined target also reuses its decision instead of reopening it merely because another window was judged. capture timestamps and every idle second do not create equivalent model calls.

Autonomous Chat gets exactly that target and source/change. Other screen content, stale lyrics, other media sessions and ordinary chat history are excluded from this turn. Ordinary user chat retains the original conversation history, and successful autonomous text still enters the ordinary conversation. Persona is unchanged.

The observation registry alone owns reservation, success and optional summaries. Successful delivery means completed, nonempty, not revoked text added to the visible/session buffers with persistence invoked; conversation storage is best-effort, not a confirmed disk-write receipt. TTS success is not required. Failed/empty/revoked output releases reservation after the normal cooldown. Delivery records the intended candidate, never claims it classified the actual reply.

Recent summaries expire after ten minutes even if a handled target remains observed. The useful opt-in setting remains as replyHistoryEnabled, default false, with summaries capped/redacted to 240 characters. Config loading migrates an old explicit eventHistoryEnabled boolean once and removes that key. Other formal settings and conversation data are preserved. Turning summaries off clears them while retaining handled facts. No runtime adapter or dual Event/Observation state exists.

## Media freshness

A media judgment can be old by the time it returns. A passing candidate is revalidated with one fresh native read before Chat; changed/missing/ambiguous identity discards it. During generation, ordinary polls revoke only an obsolete media target. Before a nonempty media result is delivered, Stage reads again to close the final polling gap. These extra reads are business validation, identical with diagnostics on or off; they do not add model judgments. Stage coalesces a concurrent poll/final check into the same native read, avoiding false cancellation from the observer’s single-request restriction.

Revocation removes partial text, suppresses subsequent partial/final output, Speech and Emotion, and resets Core history to persisted conversation so canceled media text cannot remain. The provider API has no cancellation protocol; its already-started request may still finish. Foreground replies are not revoked merely because another window/content appears; they stay attributed to their accepted candidate.

## Archived pre-P1 evidence (P0.5)

The archived pre-P1 run contained 738 samples, 463 Jev call entries, 27 deliveries over 1541.962 seconds. These counts do not describe the current mixed-session diagnostic file. 282 samples changed only idle; media count changed 58 times among 0/1/2. Five deliveries had a later captured media-change sample before final delivery. No reply text was saved.

Source proves old requests could finish after a switch; old combined input allowed stale UIA/history or multiple sessions to supply a competing target. Logs support timing overlap and metadata volatility, but do not identify actual A/B names, model topics or whether a changed media fingerprint was a song change. Native GSMTC enumerates all Playing sessions, with no authoritative session selection; UIA is a separate read. P1 prevents competing inputs and revalidates observed targets, but cannot prove system metadata is current or recover uncaptured changes.

Other boundaries: exact sampled versions are not semantic page identity; changes outside the 2000-character sample are unknown. Dynamic text not associated with a known media app can still form new versions. App ownership cannot distinguish independent windows inside one media-playing browser/process; conservatively suppressing that app's UIA can miss opportunities. Persistent competing media identities do not produce a media candidate rather than selecting a guessed song. Finite retention can allow a long-absent target again. Model semantic drift remains possible despite a clear target.

P1.1 cannot distinguish a stable same-title UIA decoration update from a genuine same-title content/scroll change. Both remain eligible if unseen and stable after delivery. Content sampled during generation or pending when leaving a previously replied-to scope can be retired even if it was a meaningful scroll; a later unseen stable section or new title can still respond. No text similarity, inferred scroll position or semantic page matcher is used.

## P1.1 runtime evidence and PDF investigation

The 2026-10-14 local 10:07 trace retains the Chrome object and title fingerprint across several text versions. The 10:07:35 candidate receives 0.74 then cooldown; 10:07:57 restores it and its cache, delivering at 10:08:03. A version sampled at 10:08:01 while that turn runs later restores at 10:08:35 and delivers at 10:08:44. This confirms pending-version restoration, not loss of object association. Text hashes cannot establish why the UIA changed. P1.1 retires the former on departure and the latter on delivery.

In the user-identified Chrome PDF interval 10:13:56–10:14:36, 21 samples share one title fingerprint but contain 14 distinct normalized UIA fingerprints, with lengths 676, 752, 1301, 1778, 1837 and 2000. There are 13 fresh judgments scored 0.50–0.64, plus reuse of an earlier 0.60 cache. Low scores do not establish absence of body text or the reason for rejection.

Native kernel.cpp `text/read/content` reads cached **Name** properties across the whole window subtree, collecting visible Text/Document/Hyperlink/Edit/ListItem/DataItem/TreeItem controls in tree order. It suppresses ancestor/consecutive duplicates and caps text at 2000 UTF-16 units at the bridge. It does not select a PDF document subtree or use TextPattern, PDF bytes, OCR or semantic region labels. Button controls are excluded, but visible text/edit/list/tree descendants in browser chrome, PDF toolbars, thumbnail labels and the document can all enter the same sample when Chrome exposes them. Early nodes can consume the cap before body nodes. Logs contain lengths/hashes, not raw UIA trees/bodies, so exact body/toolbar/thumbnail composition for this run remains unverified. No collector or PDF adapter is changed in P1.1.

## Manual acceptance

Fully quit/restart Electron after rebuilding. Enable diagnostics using desktop-diagnostics.md; optionally opt into delivered reply text. Keep real thresholds, cooldown and keys unchanged.

1. A -> B: wait for A, switch to B, including a switch while A streams. After two stable B captures, any new request must target B. A media result observed stale must not be delivered. Keep candidateId/objectId/judgmentId, media-revalidated/media-delivery-check and cancellation logs.
2. Same song: keep lyrics scrolling. Media candidate stays handled; UIA changes may log, but no new song candidate or equivalent Jev calls should follow.
3. Chrome -> QQ -> Chrome: wait for an article reply, ensure a QQ sample is logged, return unchanged. Same article version remains handled. Then load genuinely different content and check a new candidate.
4. Static desktop: after delivery, leave unchanged. Raw idle grows but does not continuously call Jev. A declined target may get one idle opening; a continuous idle does not repeat that opening.

P1.1 acceptance: include same-title UIA variation during generation, and a passing revision blocked by cooldown before Chrome -> QQ -> Chrome. Returning to those observed versions should log foreground-superseded, with no cached high-score generation. Then expose a previously unseen stable section or new title: one foreground-stabilizing sample followed by an eligible candidate. Keep the history setting unchanged; automated tests cover both settings. Stable same-title UIA noise remains a documented limit.

All automated verification uses Mock/native substitutes. The user reports preliminary P1/P1.1 real desktop acceptance was good, including P1 song-switch, lyric-loop, static desktop and new-page checks. Specific P1.1 case-by-case runtime logs were not supplied for the closing cleanup. Do not treat Mock success as real model acceptance.

## Automated verification status

P1.1 verifies 64 focused registry/controller/Stage tests (11 added). Closing verification and repository details are recorded in [P1.1 engineering baseline](./p1.1-baseline.md). The closing full run reconfirms the unchanged Live2D idle-life.test.ts:87 mismatch (expected -0.65, implementation -0.8); this is independent of the desktop cleanup and its assertion is preserved.
