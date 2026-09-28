<script setup lang="ts">
import type { Cubism4InternalModel, Live2DModel as Live2DModelType } from 'pixi-live2d-display/cubism4'

import { Application, Point, Ticker, UPDATE_PRIORITY } from 'pixi.js'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { createParameterController, type CoreModelLike, type ParameterSource } from '../live2d/parameter-controller'
import { createRig, type Live2DRig } from '../live2d/rig'
import {
  fitDesktopCharacter,
  CHARACTER_DISPLAY_LIMITS,
  fitStageCharacter,
  type CharacterDisplayTransform,
  type StageCharacterLayout,
} from '../live2d/presentation'

const props = defineProps<{
  modelSrc: string
  cubismCoreSrc: string
  transform: CharacterDisplayTransform
  desktop?: boolean
  stageLayout?: StageCharacterLayout
  /** Application-layer parameter sources applied right after the native motion update. */
  sources?: ParameterSource[]
}>()

const emit = defineEmits<{
  ready: [rig: Live2DRig]
  error: [error: Error]
  pointer: [direction: { x: number; y: number } | undefined]
  tap: []
  move: [delta: { x: number; y: number }]
  layout: [layout: StageCharacterLayout]
}>()

const container = ref<HTMLDivElement>()
const controller = createParameterController()
let app: Application | undefined
let model: Live2DModelType | undefined
let modelSize: { width: number; height: number } | undefined
let stageGeometry: Pick<StageCharacterLayout, 'body' | 'envelope' | 'centerX'> | undefined
let stageLayout: StageCharacterLayout | undefined
let canvasTopPadding = 0
let resizeObserver: ResizeObserver | undefined
let disposed = false
let coreLoad: Promise<void> | undefined
let pendingDtMs = 0
let stopCursor: (() => void) | undefined
let pressed: { id: number; x: number; y: number; offsetY: number; moved: boolean } | undefined
let gazeCenter: Point | undefined
let lastCursor: { x: number; y: number; at: number } | undefined
let attentionAt = 0
let lastMotionAt = 0
let restUntil = 0
let following = false
let near = false
let idleDelayMs = 750
const NEAR_GAZE_RANGE = 300
const FAST_CURSOR_SPEED = 900

function releaseAttention(now: number): void {
  if (!following) return
  following = false
  restUntil = now + 1_200
  emit('pointer', undefined)
}

function canvasPoint(x: number, y: number): Point | undefined {
  if (!app)
    return
  const rect = app.view.getBoundingClientRect()
  if (!rect.width || !rect.height)
    return
  return new Point((x - rect.left) * app.screen.width / rect.width, (y - rect.top) * app.screen.height / rect.height)
}

function pointAt(x: number, y: number, clicked = false): void {
  const point = canvasPoint(x, y)
  if (!model || !app || !point || !gazeCenter)
    return
  const now = performance.now()
  const moved = lastCursor ? Math.hypot(x - lastCursor.x, y - lastCursor.y) : 0
  const speed = lastCursor ? moved * 1000 / Math.max(16, now - lastCursor.at) : 0
  lastCursor = { x, y, at: now }
  const center = model.toGlobal(gazeCenter)
  const rect = app.view.getBoundingClientRect()
  const centerX = rect.left + center.x * rect.width / app.screen.width
  const centerY = rect.top + center.y * rect.height / app.screen.height
  const distance = Math.hypot(x - centerX, y - centerY)
  const wasNear = near
  near = distance <= NEAR_GAZE_RANGE
  if (wasNear && !near && following)
    attentionAt = lastMotionAt = now
  if (!following) {
    if (!near && now < restUntil && !clicked) return
    if (!near && !clicked && !(moved >= 12 && speed >= FAST_CURSOR_SPEED)) return
    following = true
    attentionAt = lastMotionAt = now
    idleDelayMs = 750 + Math.random() * 1_250
  }
  if (moved >= 3 || clicked)
    lastMotionAt = now
  model.toModelPosition(point, point)
  // Aim around the face, rather than the centre of the full-body canvas.
  emit('pointer', {
    x: (point.x / model.internalModel.originalWidth - 0.5) * 2,
    y: (0.25 - point.y / model.internalModel.originalHeight) * 3,
  })
}

function onPointerMove(event: PointerEvent): void {
  if (props.desktop)
    return // The OS cursor stream also covers the space outside the pet window.
  if (pressed && pressed.id === event.pointerId && model) {
    const dy = event.clientY - pressed.y
    pressed.moved ||= Math.abs(dy) > 6
    if (pressed.moved && stageLayout) {
      const fitted = fitStageCharacter(stageLayout, { ...props.transform, offsetY: pressed.offsetY + dy })
      positionStageModel(fitted)
    }
  }
  pointAt(event.clientX, event.clientY)
}

function onPointerDown(event: PointerEvent): void {
  if (!props.desktop && event.button === 0)
    pointAt(event.clientX, event.clientY, true)
  if (props.desktop || event.button !== 0 || pressed || !model)
    return
  const point = canvasPoint(event.clientX, event.clientY)
  if (!point || !model.hitTest(point.x, point.y).length)
    return
  pressed = { id: event.pointerId, x: event.clientX, y: event.clientY, offsetY: props.transform.offsetY, moved: false }
  ;(app!.view as HTMLCanvasElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}

function onPointerUp(event: PointerEvent): void {
  if (!pressed || pressed.id !== event.pointerId)
    return
  const start = pressed
  pressed = undefined
  if (event.type === 'pointercancel') {
    resize()
    return
  }
  if (start.moved || Math.abs(event.clientY - start.y) > 6) {
    const fitted = stageLayout && fitStageCharacter(stageLayout, { ...props.transform, offsetY: start.offsetY + event.clientY - start.y })
    if (fitted) {
      emit('move', { x: 0, y: fitted.transform.offsetY - props.transform.offsetY })
      positionStageModel(fitted)
    }
  }
  else {
    emit('tap')
  }
}

function clearPointer(): void {
  following = false
  near = false
  lastCursor = undefined
  restUntil = 0
  emit('pointer', undefined)
  if (pressed) {
    pressed = undefined
    resize()
  }
}

watch(() => props.sources, (sources) => controller.setSources(sources ?? []), { immediate: true })

function loadCubismCore(src: string): Promise<void> {
  if (coreLoad)
    return coreLoad

  coreLoad = new Promise((resolve, reject) => {
    const host = window as Window & { module?: { exports: unknown }; exports?: unknown }
    const previousModule = host.module
    const previousExports = host.exports
    const commonJsModule = { exports: {} as { then?: (ready: () => void) => void } }
    const script = document.createElement('script')
    const timeout = window.setTimeout(() => finish(new Error(`Cubism Core timed out while loading from ${src}`)), 10_000)
    let settled = false

    function restoreGlobals(): void {
      if (previousModule === undefined)
        delete host.module
      else
        host.module = previousModule
      if (previousExports === undefined)
        delete host.exports
      else
        host.exports = previousExports
    }

    function finish(error?: Error): void {
      if (settled)
        return
      settled = true
      window.clearTimeout(timeout)
      restoreGlobals()
      error ? reject(error) : resolve()
    }

    host.module = commonJsModule
    host.exports = commonJsModule.exports
    script.src = src
    script.async = true
    script.addEventListener('load', () => {
      restoreGlobals()
      const runtimeReady = commonJsModule.exports.then
      runtimeReady ? runtimeReady(() => finish()) : finish()
    }, { once: true })
    script.addEventListener('error', () => finish(new Error(`Unable to load Cubism Core from ${src}`)), { once: true })
    document.head.append(script)
  })
  return coreLoad
}

function resize(): void {
  if (!app || !model || !modelSize || !container.value)
    return

  const width = container.value.clientWidth
  const visibleHeight = props.desktop ? container.value.parentElement?.clientHeight ?? 0 : container.value.clientHeight
  if (!width || !visibleHeight)
    return

  if (!props.desktop && stageGeometry) {
    stageLayout = { width, height: visibleHeight, ...stageGeometry }
    emit('layout', stageLayout)
    const highest = fitStageCharacter(stageLayout, { scale: CHARACTER_DISPLAY_LIMITS.scale.max, offsetX: 0, offsetY: -Number.MAX_SAFE_INTEGER })
    canvasTopPadding = Math.ceil(Math.max(0, -(highest.y + stageGeometry.envelope.y * highest.scale - stageGeometry.body.height * highest.scale * 0.06)))
    const canvasHeight = visibleHeight + canvasTopPadding
    app.renderer.resize(width, canvasHeight)
    Object.assign((app.view as HTMLCanvasElement).style, { position: 'absolute', top: `${-canvasTopPadding}px`, height: `${canvasHeight}px` })
    positionStageModel(fitStageCharacter(stageLayout, props.transform))
    return
  }

  if (props.desktop && stageGeometry) {
    const fitted = fitDesktopCharacter({ width, height: visibleHeight }, props.stageLayout ?? { width, height: visibleHeight, ...stageGeometry }, props.transform)
    window.aislingDesktop?.resizeDesktop(fitted.windowWidth, fitted.windowHeight)
    canvasTopPadding = 0
    // Only the native window clips the model. Include the complete lower meshes,
    // including motion margin, so entrance overshoot cannot reveal a canvas edge.
    const fullHeight = fitted.canvasHeight
    container.value.style.height = `${fullHeight}px`
    app.renderer.resize(width, fullHeight)
    positionStageModel(fitted)
    return
  }
}

function positionStageModel(fitted: ReturnType<typeof fitStageCharacter>): void {
  if (!model || !modelSize) return
  model.scale.set(fitted.scale)
  model.position.set(fitted.x + modelSize.width * fitted.scale / 2, fitted.y + modelSize.height * fitted.scale / 2 + canvasTopPadding)
}

function readStageGeometry(): Pick<StageCharacterLayout, 'body' | 'envelope' | 'centerX'> {
  const internal = model!.internalModel as Cubism4InternalModel
  const hitIndices = new Set(Object.values(internal.hitAreas).map(area => area.index))
  const body = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  const envelope = { ...body }
  const point = new Point()
  for (let index = 0; index < internal.coreModel.getDrawableCount(); index++) {
    if (hitIndices.has(index)) continue
    const vertices = internal.getDrawableVertices(index)
    const visible = internal.coreModel.getDrawableOpacity(index) > 0
    const targets = visible ? [body, envelope] : [envelope]
    for (let i = 0; i < vertices.length; i += 2) {
      point.set(vertices[i], vertices[i + 1])
      internal.localTransform.apply(point, point)
      for (const bounds of targets) {
        bounds.left = Math.min(bounds.left, point.x)
        bounds.top = Math.min(bounds.top, point.y)
        bounds.right = Math.max(bounds.right, point.x)
        bounds.bottom = Math.max(bounds.bottom, point.y)
      }
    }
  }
  const rect = (bounds: typeof body) => Number.isFinite(bounds.left) && bounds.bottom > bounds.top && bounds.right > bounds.left
    ? { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }
    : { x: 0, y: 0, ...modelSize! }
  // Hit areas describe the body rather than the asymmetric wand/effect bounds.
  const areas = Object.values(internal.hitAreas)
  const torso = areas.find(area => /body/i.test(area.id)) ?? areas.find(area => /head/i.test(area.id))
  const bounds = torso && internal.getDrawableBounds(torso.index)
  const centerX = bounds
    ? internal.localTransform.apply(new Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)).x
    : internal.width / 2
  return { body: rect(body), envelope: rect(envelope), centerX }
}

function update(): void {
  if (!app || !model)
    return

  const now = performance.now()
  if (following && !near && (now - attentionAt > 5_000 || now - lastMotionAt > idleDelayMs))
    releaseAttention(now)

  // Only advances the model clock; the Cubism update itself runs at render time.
  pendingDtMs += app.ticker.deltaMS
  model.update(app.ticker.deltaMS)
}

// Cubism keeps last frame's values; hand the motion the native ones back.
function restoreLayers(): void {
  if (model)
    controller.restore(model.internalModel.coreModel as unknown as CoreModelLike)
}

// Runs inside the Cubism update, right after the motion wrote its values and
// before expressions, physics, pose and the mesh update: app layers (idle life,
// emotion, speech mouth) sit on top of the motion and physics reacts to them.
function applyLayers(): void {
  if (!model)
    return
  controller.apply(model.internalModel.coreModel as unknown as CoreModelLike, pendingDtMs)
  pendingDtMs = 0
}

async function mountRenderer(): Promise<void> {
  try {
    await loadCubismCore(props.cubismCoreSrc)
    const { Live2DModel } = await import('pixi-live2d-display/cubism4')
    if (disposed || !container.value)
      return

    Live2DModel.registerTicker(Ticker)

    app = new Application({
      backgroundAlpha: 0,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    })
    app.ticker.maxFPS = 60
    app.view.className = 'live2d-canvas'
    container.value.append(app.view)

    const loaded = await Live2DModel.from(props.modelSrc, { autoInteract: false, autoUpdate: false })
    if (disposed) {
      loaded.destroy()
      return
    }

    const rig = await createRig(loaded)
    if (disposed) {
      loaded.destroy()
      return
    }

    model = loaded
    const head = Object.values(model.internalModel.hitAreas).find(area => /head/i.test(area.id))
    const bounds = head && model.internalModel.getDrawableBounds(head.index)
    gazeCenter = bounds
      ? new Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      : new Point(model.internalModel.originalWidth / 2, model.internalModel.originalHeight / 4)
    // Idle life owns blinking. The native blinker only runs on the one-frame gap
    // between motions and would overwrite the layers' eyes there (a visible flash).
    ;(model.internalModel as Cubism4InternalModel).eyeBlink = undefined
    model.internalModel.on('beforeMotionUpdate', restoreLayers)
    model.internalModel.on('afterMotionUpdate', applyLayers)
    modelSize = { width: model.width, height: model.height }
    stageGeometry = readStageGeometry()
    model.anchor.set(0.5)
    app.stage.addChild(model)
    app.ticker.add(update, undefined, UPDATE_PRIORITY.HIGH)
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container.value)
    if (props.desktop && container.value.parentElement)
      resizeObserver.observe(container.value.parentElement)
    resize()
    if (props.desktop)
      stopCursor = window.aislingDesktop?.onCursor(pointAt)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('blur', clearPointer)
    document.documentElement.addEventListener('pointerleave', clearPointer)
    emit('ready', rig)
  }
  catch (cause) {
    if (!disposed)
      emit('error', cause instanceof Error ? cause : new Error(String(cause)))
  }
}

function destroyRenderer(): void {
  disposed = true
  stopCursor?.()
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('blur', clearPointer)
  document.documentElement.removeEventListener('pointerleave', clearPointer)
  resizeObserver?.disconnect()
  if (app)
    app.ticker.remove(update)
  if (app && model)
    app.stage.removeChild(model)
  model?.destroy({ children: true, texture: true, baseTexture: true })
  app?.destroy(true, { children: true, texture: true, baseTexture: true })
  model = undefined
  gazeCenter = undefined
  lastCursor = undefined
  following = false
  near = false
  modelSize = undefined
  app = undefined
}

onMounted(() => void mountRenderer())
onBeforeUnmount(destroyRenderer)
watch(() => [props.transform.scale, props.transform.offsetX, props.transform.offsetY, props.desktop ? props.stageLayout : undefined], resize)
</script>

<template>
  <div ref="container" class="live2d-renderer" :class="{ desktop }" @pointerdown="onPointerDown" @pointerup="onPointerUp" @pointercancel="onPointerUp" @lostpointercapture="clearPointer" />
</template>

<style scoped>
.live2d-renderer {
  position: relative;
  width: 100%;
  height: 100%;
  touch-action: none;
  overflow: visible;
}

.live2d-renderer.desktop { position: absolute; top: 0; left: 0; overflow: visible; }

.live2d-renderer :deep(.live2d-canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
