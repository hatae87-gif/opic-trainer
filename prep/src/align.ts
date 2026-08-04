import type { SentencePair } from './types.js'
import type { Transcription } from './transcribe.js'

/** 문장 경계 앞뒤로 주는 여유(초). 어두음이 잘리는 것을 막는다 */
const PADDING = 0.12
/** 문장 단어 중 이 비율 이상이 매칭돼야 신뢰한다 */
const CONFIDENCE_MIN = 0.5

const CONTRACTIONS: Record<string, string> = {
  "i'm": 'i am',
  "it's": 'it is',
  "that's": 'that is',
  "there's": 'there is',
  "she's": 'she is',
  "he's": 'he is',
  "what's": 'what is',
  "who's": 'who is',
  "don't": 'do not',
  "doesn't": 'does not',
  "didn't": 'did not',
  "can't": 'can not',
  "couldn't": 'could not',
  "wouldn't": 'would not',
  "isn't": 'is not',
  "aren't": 'are not',
  "wasn't": 'was not',
  "i've": 'i have',
  "we've": 'we have',
  "i'd": 'i would',
  "i'll": 'i will',
}

/** 소문자화·문장부호 제거·축약형 통일. 원문과 인식 결과를 같은 표기로 만든다 */
function normalizeWords(text: string): string[] {
  let t = text.toLowerCase().replace(/[’‘]/g, "'")
  for (const [from, to] of Object.entries(CONTRACTIONS)) {
    t = t.replaceAll(from, to)
  }
  return t
    .replace(/\(주제\)s?|\(장소\)s?|\(소요시간\)|00/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * 원문 단어열 ↔ 인식 단어열을 Needleman-Wunsch로 정렬한다.
 * ref[i] 가 어떤 인식 단어에 대응하는지(hyp 인덱스)를 돌려준다. 미매칭은 -1.
 */
function alignWords(ref: string[], hyp: string[]): number[] {
  const R = ref.length
  const H = hyp.length
  const MATCH = 2
  const MISMATCH = -1
  const GAP = -1

  const score: Int32Array[] = Array.from({ length: R + 1 }, () => new Int32Array(H + 1))
  for (let i = 1; i <= R; i++) score[i][0] = i * GAP
  for (let j = 1; j <= H; j++) score[0][j] = j * GAP

  const similar = (a: string, b: string): boolean => {
    if (a === b) return true
    // 짧은 단어가 아니면 앞 4글자 일치도 인정 — Whisper의 어미 변형(enjoying/enjoy) 흡수
    return a.length >= 5 && b.length >= 5 && a.slice(0, 4) === b.slice(0, 4)
  }

  for (let i = 1; i <= R; i++) {
    for (let j = 1; j <= H; j++) {
      const diag = score[i - 1][j - 1] + (similar(ref[i - 1], hyp[j - 1]) ? MATCH : MISMATCH)
      const up = score[i - 1][j] + GAP
      const left = score[i][j - 1] + GAP
      score[i][j] = Math.max(diag, up, left)
    }
  }

  const map = new Array<number>(R).fill(-1)
  let i = R
  let j = H
  while (i > 0 && j > 0) {
    const diag = score[i - 1][j - 1] + (similar(ref[i - 1], hyp[j - 1]) ? MATCH : MISMATCH)
    if (score[i][j] === diag) {
      if (similar(ref[i - 1], hyp[j - 1])) map[i - 1] = j - 1
      i--
      j--
    } else if (score[i][j] === score[i - 1][j] + GAP) {
      i--
    } else {
      j--
    }
  }
  return map
}

/**
 * 문장별 오디오 구간을 채운다.
 *
 * 스크립트 영어 원문을 이미 알고 있으므로, Whisper 인식 결과와 단어 단위로 정렬한 뒤
 * 각 문장의 첫/끝 단어가 매칭된 타임스탬프를 구간으로 삼는다.
 */
export function alignSentences(sentences: SentencePair[], tr: Transcription): void {
  const hypWords = tr.words.flatMap((w, idx) =>
    normalizeWords(w.word).map((token) => ({ token, idx })),
  )
  const hypTokens = hypWords.map((w) => w.token)

  const refTokens: string[] = []
  /** refTokens[i] 가 몇 번째 문장 소속인지 */
  const owner: number[] = []
  for (const s of sentences) {
    for (const token of normalizeWords(s.en)) {
      refTokens.push(token)
      owner.push(s.order)
    }
  }

  const map = alignWords(refTokens, hypTokens)

  for (const s of sentences) {
    const indices = map.filter((h, r) => h >= 0 && owner[r] === s.order)
    const total = owner.filter((o) => o === s.order).length
    if (indices.length === 0 || total === 0) {
      s.needsReview = true
      continue
    }
    const first = tr.words[hypWords[indices[0]].idx]
    const last = tr.words[hypWords[indices[indices.length - 1]].idx]
    s.start = Math.max(0, first.start - PADDING)
    s.end = Math.min(tr.duration || last.end + PADDING, last.end + PADDING)
    s.needsReview = indices.length / total < CONFIDENCE_MIN
  }

  // 구간이 서로 겹치면 경계를 중간 지점으로 정리한다
  const timed = sentences.filter((s) => s.start !== undefined)
  for (let k = 1; k < timed.length; k++) {
    const prev = timed[k - 1]
    const cur = timed[k]
    if (prev.end! > cur.start!) {
      const mid = (prev.end! + cur.start!) / 2
      prev.end = mid
      cur.start = mid
    }
  }

  // 매칭이 안 된 문장은 이웃 구간으로 메운다 — 재생이 끊기지 않게
  for (let k = 0; k < sentences.length; k++) {
    const s = sentences[k]
    if (s.start !== undefined) continue
    const prev = sentences.slice(0, k).reverse().find((x) => x.end !== undefined)
    const next = sentences.slice(k + 1).find((x) => x.start !== undefined)
    s.start = prev?.end ?? 0
    s.end = next?.start ?? tr.duration
    s.needsReview = true
  }
}
