import { useCallback, useRef, useState } from 'react'
import { getDB } from '../db/db'

/** 문장별로 남길 내 녹음 개수. 넘치면 오래된 것부터 지운다 */
const KEEP = 3

export interface RecorderState {
  /** 지금 녹음 중인 문장 id */
  recording: string | null
  error: string | null
}

export function useRecorder() {
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const [state, setState] = useState<RecorderState>({ recording: null, error: null })

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
          })
          // 오래된 녹음 정리
          const all = await db.getAllFromIndex('recordings', 'bySentence', sentenceKey)
          const excess = all.sort((a, b) => b.createdAt - a.createdAt).slice(KEEP)
          for (const r of excess) await db.delete('recordings', r.id)
        }
        setState({ recording: null, error: null })
      }
      mediaRef.current = recorder
      recorder.start()
      setState({ recording: sentenceKey, error: null })
    } catch {
      setState({
        recording: null,
        error: '마이크를 사용할 수 없습니다. 권한을 허용했는지 확인해주세요.',
      })
    }
  }, [])

  const stop = useCallback(() => {
    mediaRef.current?.stop()
    mediaRef.current = null
  }, [])

  return { state, start, stop }
}

export async function latestRecording(sentenceKey: string): Promise<Blob | null> {
  const db = await getDB()
  const all = await db.getAllFromIndex('recordings', 'bySentence', sentenceKey)
  if (all.length === 0) return null
  return all.sort((a, b) => b.createdAt - a.createdAt)[0].blob
}
