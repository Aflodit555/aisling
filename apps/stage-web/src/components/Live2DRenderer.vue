<script setup lang="ts">
import type { Live2DModel as Live2DModelType } from 'pixi-live2d-display/cubism4'

import { Application, Ticker, UPDATE_PRIORITY } from 'pixi.js'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { createParameterController, type CoreModelLike, type ParameterSource } from '../live2d/parameter-controller'
import {
  applyCharacterDisplayTransform,
  fitLive2DModel,
  type CharacterDisplayTransform,
} from '../live2d/presentation'

const props = defineProps<{
  modelSrc: string
  cubismCoreSrc: string
  transform: CharacterDisplayTransform
  /** Application-layer parameter sources applied after the native model update. */
  sources?: ParameterSource[]
}>()

const emit = defineEmits<{
  ready: []
  error: [error: Error]
}>()

const container = ref<HTMLDivElement>()
const controller = createParameterController()
let app: Application | undefined
let model: Live2DModelType | undefined
let modelSize: { width: number; height: number } | undefined
let resizeObserver: ResizeObserver | undefined
let disposed = false
let coreLoad: Promise<void> | undefined

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

  const { clientWidth: width, clientHeight: height } = container.value
  if (!width || !height)
    return

  app.renderer.resize(width, height)
  const fitted = applyCharacterDisplayTransform(
    fitLive2DModel({ width, height }, modelSize),
    props.transform,
  )
  model.scale.set(fitted.scale)
  model.position.set(fitted.x, fitted.y)
}

function update(): void {
  if (!app || !model)
    return

  // Native Cubism update first: Idle motion / blink / physics write their own
  // parameters. The Parameter Controller then applies app-layer overrides
  // (manual pose, speech mouth) above that base value.
  const dtMs = app.ticker.deltaMS
  model.update(dtMs)
  const core = model.internalModel.coreModel as unknown as CoreModelLike
  controller.apply(core, dtMs)
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
    app.view.className = 'live2d-canvas'
    container.value.append(app.view)

    const loaded = await Live2DModel.from(props.modelSrc, { autoInteract: false, autoUpdate: false })
    if (disposed) {
      loaded.destroy()
      return
    }

    model = loaded
    modelSize = { width: model.width, height: model.height }
    model.anchor.set(0.5)
    app.stage.addChild(model)
    app.ticker.add(update, undefined, UPDATE_PRIORITY.HIGH)
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container.value)
    resize()
    emit('ready')
  }
  catch (cause) {
    if (!disposed)
      emit('error', cause instanceof Error ? cause : new Error(String(cause)))
  }
}

function destroyRenderer(): void {
  disposed = true
  resizeObserver?.disconnect()
  if (app)
    app.ticker.remove(update)
  if (app && model)
    app.stage.removeChild(model)
  model?.destroy({ children: true, texture: true, baseTexture: true })
  app?.destroy(true, { children: true, texture: true, baseTexture: true })
  model = undefined
  modelSize = undefined
  app = undefined
}

onMounted(() => void mountRenderer())
onBeforeUnmount(destroyRenderer)
watch(() => [props.transform.scale, props.transform.offsetX, props.transform.offsetY], resize)
</script>

<template>
  <div ref="container" class="live2d-renderer" />
</template>

<style scoped>
.live2d-renderer {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.live2d-renderer :deep(.live2d-canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
