import { useCallback, useEffect, useRef, useState } from 'react'

export type Speed = 0.6 | 0.8 | 1 | 1.2

export interface PlayerState {
  /** 지금 재생 중인 문장 order. 전체 재생 중에도 현재 위치의 문장을 가리킨다 */
  playing: number | null
  loop: boolean
  speed: Speed
  /** 전체 재생 모드인지 (문장 하나만인지) */
  wholeMode: boolean
}

export interface Segment {
  order: number
  start?: number
  end?: number
}

/**
 * 스크립트 하나의 오디오를 다루는 재생 엔진.
 * 단일 <audio> 엘리먼트 + timeupdate 로 문장 구간 A-B 재생/반복을 구현한다.
 */
export function usePlayer(blob: Blob | null, segments: Segment[]) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  /** timeupdate 핸들러가 참조하는 현재 구간. state와 달리 즉시 갱신된다 */
  const activeRef = useRef<{ start: number; end: number; order: number; loop: boolean; whole: boolean } | null>(null)
  const [state, setState] = useState<PlayerState>({ playing: null, loop: false, speed: 1, wholeMode: false })
  const speedRef = useRef<Speed>(1)

  useEffect(() => {
    if (!blob) return
    const audio = new Audio()
    const url = URL.createObjectURL(blob)
    audio.src = url
    audio.preload = 'auto'
    // 속도를 바꿔도 음정이 유지되게 한다 (기본값이지만 명시)
    ;(audio as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true
    audioRef.current = audio
    urlRef.current = url

    const onTime = () => {
      const active = activeRef.current
      if (!active) return
      if (audio.currentTime >= active.end) {
        if (active.loop) {
          audio.currentTime = active.start
        } else if (active.whole) {
          // 전체 재생: 다음 구간으로 하이라이트만 옮긴다
          const next = segments.find((s) => s.start !== undefined && s.start >= active.end - 0.05)
          if (next && next.start !== undefined && next.end !== undefined) {
            activeRef.current = { ...active, start: next.start, end: next.end, order: next.order }
            setState((p) => ({ ...p, playing: next.order }))
          } else {
            activeRef.current = null
            audio.pause()
            setState((p) => ({ ...p, playing: null, wholeMode: false }))
          }
        } else {
          activeRef.current = null
          audio.pause()
          setState((p) => ({ ...p, playing: null }))
        }
      }
    }
    const onEnded = () => {
      activeRef.current = null
      setState((p) => ({ ...p, playing: null, wholeMode: false }))
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnded)
      audio.pause()
      URL.revokeObjectURL(url)
      audioRef.current = null
    }
  }, [blob, segments])

  const stop = useCallback(() => {
    activeRef.current = null
    audioRef.current?.pause()
    setState((p) => ({ ...p, playing: null, wholeMode: false }))
  }, [])

  const playSegment = useCallback(
    (order: number, opts?: { loop?: boolean }) => {
      const audio = audioRef.current
      const seg = segments.find((s) => s.order === order)
      if (!audio || !seg || seg.start === undefined || seg.end === undefined) return
      const loop = opts?.loop ?? false
      activeRef.current = { start: seg.start, end: seg.end, order, loop, whole: false }
      audio.currentTime = seg.start
      audio.playbackRate = speedRef.current
      void audio.play()
      setState((p) => ({ ...p, playing: order, loop, wholeMode: false }))
    },
    [segments],
  )

  const playWhole = useCallback(() => {
    const audio = audioRef.current
    const first = segments.find((s) => s.start !== undefined && s.end !== undefined)
    if (!audio) return
    if (first && first.start !== undefined && first.end !== undefined) {
      activeRef.current = { start: first.start, end: first.end, order: first.order, loop: false, whole: true }
      audio.currentTime = first.start
      setState((p) => ({ ...p, playing: first.order, loop: false, wholeMode: true }))
    } else {
      // 구간 정보가 아예 없으면 그냥 처음부터 튼다
      activeRef.current = null
      audio.currentTime = 0
      setState((p) => ({ ...p, playing: null, wholeMode: true }))
    }
    audio.playbackRate = speedRef.current
    void audio.play()
  }, [segments])

  const setSpeed = useCallback((speed: Speed) => {
    speedRef.current = speed
    if (audioRef.current) audioRef.current.playbackRate = speed
    setState((p) => ({ ...p, speed }))
  }, [])

  return { state, playSegment, playWhole, stop, setSpeed, hasAudio: blob !== null }
}
