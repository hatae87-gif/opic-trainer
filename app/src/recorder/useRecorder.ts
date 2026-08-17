import { useCallback, useRef, useState } from 'react'
import { getDB } from '../db/db'

/** 문장별로 남길 내 녹음 개수. 넘치면 오래된 것부터 지운다 */
const KEEP = 3

export interface RecorderState {
  /** 지금 녹음 중인 문장 id */
  recording: string | null
  error: string | null
  /** 녹음 시작 후 경과 초 */
  elapsed: number
}

/** 경과 초 → "0:07" 표기 */
export function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = String(sec % 60).padStart(2, '0')
  return `${m}:${s}`
}

export function useRecorder() {
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)
  const [state, setState] = useState<RecorderState>({ recording: null, error: null, elapsed: 0 })

  const stopTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }

  const start = useCallback(async (sentenceKey: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : ''
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size > 0) {
          const db = await getDB()
          await db.put('recordings', {
            id: `${sentenceKey}-${Date.now()}`,
            sentenceId: sentenceKey,
            blob,
            createdAt: Date.now(),
            // webm은 메타데이터에 길이가 안 박히는 경우가 많아 녹음 시점에 재서 저장한다
            duration: Math.round((Date.now() - startedAtRef.current) / 1000),
          })
          // 오래된 녹음 정리
          const all = await db.getAllFromIndex('recordings', 'bySentence', sentenceKey)
          const excess = all.sort((a, b) => b.createdAt - a.createdAt).slice(KEEP)
          for (const r of excess) await db.delete('recordings', r.id)
        }
        stopTick()
        setState({ recording: null, error: null, elapsed: 0 })
      }
      mediaRef.current = recorder
      recorder.start()
      startedAtRef.current = Date.now()
      setState({ recording: sentenceKey, error: null, elapsed: 0 })
      stopTick()
      tickRef.current = setInterval(() => {
        setState((p) => (p.recording ? { ...p, elapsed: p.elapsed + 1 } : p))
      }, 1000)
    } catch {
      stopTick()
      setState({
        recording: null,
        error: '마이크를 사용할 수 없습니다. 권한을 허용했는지 확인해주세요.',
        elapsed: 0,
      })
    }
  }, [])

  const stop = useCallback(() => {
    stopTick()
    mediaRef.current?.stop()
    mediaRef.current = null
  }, [])

  return { state, start, stop }
}

export async function latestRecording(sentenceKey: string): Promise<Blob | null> {
  return (await latestRecordingEntry(sentenceKey))?.blob ?? null
}

export async function latestRecordingEntry(
  sentenceKey: string,
): Promise<{ blob: Blob; duration?: number } | null> {
  const db = await getDB()
  const all = await db.getAllFromIndex('recordings', 'bySentence', sentenceKey)
  if (all.length === 0) return null
  const latest = all.sort((a, b) => b.createdAt - a.createdAt)[0]
  return { blob: latest.blob, duration: latest.duration }
}
