# Idle life and emotion

Two presentation layers sit on top of the Live2D motion. Both are applied by
the parameter controller right after the native motion update (before
expressions, physics and the mesh update), lowest priority first:

| priority | layer        | writes                                                        |
| -------- | ------------ | ------------------------------------------------------------- |
| 10       | manual pose  | head turn while Aisling is busy (eased, additive)             |
| 20       | idle life    | blinks, gaze fixations, head follow, body lean / head tilt    |
| 30       | emotion      | the emotion's Mao expression + gaze/posture offset, by weight |
| 100      | speech mouth | the model's LipSync parameter (Mao: `ParamA`)                 |

Each layer reads the value left by the ones below it, so additive layers
compose. Physics runs after them, so hair and clothes follow the head.

## Idle life (`src/live2d/idle-life.ts`)

Mao's Idle motion bakes one blink into a fixed 5.6 s loop and never moves the
eyeballs. The idle layer replaces the baked blink with irregular ones
(2.2–6 s, sometimes double), adds gaze fixations (mostly at the viewer, now
and then a glance aside, head following the eyes a little), and drifts body
lean and head tilt to a new rest point every 6–14 s. During a gesture motion
the gesture's own eyes pass through.

## Emotion

```
reply finished ──► Jev (choice + score, one request) ──► state machine ──► Live2D look
                   Electron main process                  presentation/      live2d/
                   desktop-judge.cjs                      emotion-state.ts   emotion-look.ts
```

**Categories come from the model.** Mao has five expressions that read as
different emotions; each category maps to exactly one of them. Neutral is not a
category: it is intensity 0, and the state the character returns to on its own.

| category  | Mao expression | look                                        | extra            |
| --------- | -------------- | ------------------------------------------- | ---------------- |
| joy       | `exp_02`       | eyes closed in a smile                      | head tilt, sway gesture `mtn_03` when strong |
| sad       | `exp_05`       | brows knit and lowered, mouth corners down  | head and gaze down |
| angry     | `exp_08`       | narrowed eyes, pouting mouth                | head and gaze turned away |
| surprised | `exp_07`       | eyes wide, pupils shrunk                    | head up, slight lean back |
| shy       | `exp_06`       | blush, brows knit                           | gaze down and aside |

Unused on purpose: `exp_01` (all-zero reset = neutral), `exp_03` (plain closed
eyes), `exp_04` (wide sparkly smile — joy again at another intensity; one look
per emotion keeps intensity a single axis). `special_*` motions are magic
effects, not emotions.

**Jev** (`apps/stage-desktop/desktop-judge.cjs`) gets the last six turns and,
only while Desktop Awareness is on, the focused app/title, a capped slice of
screen text and media. It answers two questions in one request:
`emotion` (choice over the five categories, with its confidence) and
`intensity` (score 0–3: none / slight / clear / strong). It needs the Jev API
key from the Desktop Awareness settings, and runs in the desktop app only.

**State machine** (`src/presentation/emotion-state.ts`). The only evidence value
is `strength = intensity × confidence`, thresholded once:

| rule                                                    | value            |
| ------------------------------------------------------- | ---------------- |
| enter an emotion from neutral                           | strength ≥ 0.20  |
| switch to another emotion                               | ≥ current + 0.15 |
| same emotion again                                      | refresh level and hold |
| hold after the last evidence (and while speaking)       | 6 s              |
| then decay                                              | half-life 4 s    |
| back to neutral                                         | level < 0.05     |
| shown weight easing                                     | rise 350 ms, fall 900 ms |

A strong reply (strength ≈ 0.6) returns to neutral about 20 s after Aisling
stops speaking. Switching cross-fades, because the weights ease independently.

**Look** (`src/live2d/emotion-look.ts`) blends each emotion's expression with
Cubism's own Add / Multiply / Overwrite rules at the emotion's weight, adds the
gaze/posture offsets, and plays the gesture once when an emotion is entered
with strength ≥ 0.6. The mapping table is Mao-specific; on a model without
those expressions only the offsets apply.

Devtools shows the live weights, the last Jev sample and its outcome. To
preview a look without Jev, run in the browser console on the Stage:

```js
const { useEmotionStore } = await import('/src/stores/emotion.ts')
useEmotionStore().offer({ emotion: 'shy', intensity: 1, confidence: 1 })
```
