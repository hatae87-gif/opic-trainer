import { useCallback, useEffect, useRef, useState } from 'react'
import { latestRecordingEntry } from './useRecorder'

export interface MyVoiceState {
  /** 지금 재생/일시정지 중인 녹음 키 */
  key: string | null
  paused: boolean
}

/**
 * 내 녹음 재생기. 한 번에 하나만 재생하며,
 * 재생 중 다시 누르면 일시정지 → 이어 듣기 / 처음부터를 고를 수 있다.
 */
export function useMyVoice(onBeforePlay?: () => void) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const [state, setState] = useState<MyVoiceState>({ key: null, paused: false })
  const beforeRef = useRef(onBeforePlay)
  beforeRef.current = onBeforePlay

  const cleanup = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [])

  useEffect(() => cleanup, [cleanup])

  const stop = useCallback(() => {
    cleanup()
    setState({ key: null, paused: false })
  }, [cleanup])

  const playFresh = useCallback(
    async (key: string) => {
      const entry = await latestRecordingEntry(key)
      if (!entry) return
      cleanup()
      beforeRef.current?.()
      const url = URL.createObjectURL(entry.blob)
      const audio = new Audio(url)
      audio.onended = () => {
        cleanup()
        setState({ key: null, paused: false })
      }
      audioRef.current = audio
      urlRef.current = url
      void audio.play()
      setState({ key, paused: false })
    },
    [cleanup],
  )

  /** 재생 버튼의 기본 동작: 처음 누르면 재생, 재생 중 누르면 일시정지, 다른 키면 새로 재생 */
  const toggle = useCallback(
    (key: string) => {
      if (state.key === key && !state.paused) {
        audioRef.current?.pause()
        setState({ key, paused: true })
      } else if (state.key === key && state.paused) {
        // 일시정지 상태에서는 이어 듣기/처음부터 버튼이 대신 떠 있다
      } else {
        void playFresh(key)
      }
    },
    [state, playFresh],
  )

  const resume = useCallback(() => {
    void audioRef.current?.play()
    setState((p) => ({ ...p, paused: false }))
  }, [])

  const restart = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
    void audio.play()
    setState((p) => ({ ...p, paused: false }))
  }, [])

  return { state, toggle, resume, restart, stop }
}
