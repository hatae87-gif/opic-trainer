/**
 * 녹음 중 "말이 끊긴 구간"을 잰다.
 *
 * SAIL 리포트가 4회 연속 지적한 항목이 pausing to plan grammar and vocabulary.
 * 답변 길이보다 이 지표가 등급에 직결되므로, 녹음할 때마다 같이 측정해 둔다.
 */

export interface SpeechStats {
  /** PAUSE_MS 이상 멈춘 횟수 (맨 앞·맨 뒤 침묵은 제외) */
  pauses: number
  /** 가장 길었던 공백 (초, 소수점 1자리) */
  longestPause: number
  /** 전체 길이 중 실제로 소리를 낸 비율 0~1 */
  speakingRatio: number
}

export const PAUSE_MS = 3000
const SAMPLE_MS = 50
/** 이보다 조용하면 무음으로 본다. 주변 소음에 맞춰 아래에서 올려 잡는다 */
const FLOOR = 0.012

export const EMPTY_STATS: SpeechStats = { pauses: 0, longestPause: 0, speakingRatio: 0 }

/**
 * 마이크 스트림을 물려 두면 50ms마다 음량을 재서 공백을 센다.
 * stop()으로 결과를 받고 오디오 리소스를 정리한다.
 */
export function createSilenceMeter(stream: MediaStream) {
  const AudioCtx: typeof AudioContext | undefined =
    typeof window !== 'undefined'
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined

  // 오래된 브라우저나 테스트 환경에서는 측정을 건너뛴다 (녹음 자체는 정상 동작)
  if (!AudioCtx) {
    return {
      currentPauseMs: () => 0,
      stop: (): SpeechStats | null => null,
    }
  }

  const ctx = new AudioCtx()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)

  let noiseFloor = FLOOR
  let samples = 0
  let speaking = 0
  /** 아직 한 번도 말하지 않았으면 앞쪽 침묵은 세지 않는다 */
  let started = false
  let silentRun = 0
  let pauses = 0
  let longest = 0

  const tick = () => {
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)

    // 조용한 구간의 음량을 천천히 따라가며 주변 소음 기준선을 잡는다
    if (rms < noiseFloor) noiseFloor = noiseFloor * 0.95 + rms * 0.05
    const threshold = Math.max(FLOOR, noiseFloor * 2.5)

    samples++
    if (rms >= threshold) {
      speaking++
      if (started && silentRun >= PAUSE_MS) {
        pauses++
        longest = Math.max(longest, silentRun)
      }
      started = true
      silentRun = 0
    } else if (started) {
      silentRun += SAMPLE_MS
    }
  }

  const timer = setInterval(tick, SAMPLE_MS)

  return {
    /** 지금 몇 ms째 조용한지 — 녹음 중 경고 표시에 쓴다 */
    currentPauseMs: () => (started ? silentRun : 0),
    stop(): SpeechStats | null {
      clearInterval(timer)
      try {
        source.disconnect()
        void ctx.close()
      } catch {
        // 이미 닫혔으면 무시
      }
      if (samples === 0 || !started) return null
      // 끝에 남은 침묵은 "말을 멈춘 것"이 아니라 녹음 종료가 늦은 것이므로 세지 않는다
      return {
        pauses,
        longestPause: Math.round(longest / 100) / 10,
        speakingRatio: Math.round((speaking / samples) * 100) / 100,
      }
    },
  }
}

/** "공백 2회 · 최장 4.5초" 같은 한 줄 요약 */
export function describeStats(s: SpeechStats): string {
  if (s.pauses === 0) return `끊김 없음 · 발화 ${Math.round(s.speakingRatio * 100)}%`
  return `3초+ 공백 ${s.pauses}회 · 최장 ${s.longestPause}초 · 발화 ${Math.round(s.speakingRatio * 100)}%`
}

/** 목표: 공백 2회 이하. 넘으면 경고색 */
export function statsTone(s: SpeechStats): 'good' | 'warn' | 'bad' {
  if (s.pauses === 0) return 'good'
  if (s.pauses <= 2) return 'warn'
  return 'bad'
}
