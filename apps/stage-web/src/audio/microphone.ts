/**
 * Audio Source: captures the microphone into a Blob. This lives in the app —
 * the core never touches browser MediaRecorder. The recording is later handed
 * to a HearingProvider (recognition), keeping "capture" and "recognize"
 * separate.
 */

export interface MicrophoneRecorder {
  start(): Promise<void>
  stop(): Promise<Blob>
  cancel(): void
}

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  if (typeof MediaRecorder === 'undefined')
    return undefined
  return candidates.find(type => MediaRecorder.isTypeSupported(type))
}

export function createMicrophoneRecorder(): MicrophoneRecorder {
  let stream: MediaStream | undefined
  let recorder: MediaRecorder | undefined
  let chunks: BlobPart[] = []

  async function start(): Promise<void> {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunks = []
    const mimeType = pickMimeType()
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0)
        chunks.push(event.data)
    }
    recorder.start()
  }

  function stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!recorder || recorder.state === 'inactive') {
        reject(new Error('No active recording'))
        return
      }
      recorder.addEventListener('stop', () => {
        const type = recorder?.mimeType || 'audio/webm'
        stream?.getTracks().forEach(track => track.stop())
        resolve(new Blob(chunks, { type }))
      }, { once: true })
      recorder.stop()
    })
  }

  function cancel(): void {
    if (recorder && recorder.state !== 'inactive')
      recorder.stop()
    stream?.getTracks().forEach(track => track.stop())
    chunks = []
  }

  return { start, stop, cancel }
}
