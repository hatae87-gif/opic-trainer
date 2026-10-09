/** prep 도구가 만드는 manifest와 같은 모양. 번들 포맷이 바뀌면 양쪽을 함께 올린다 */
export interface SentencePair {
  order: number
  en: string
  ko: string
  start?: number
  end?: number
  needsReview?: boolean
}

export interface ManifestScript {
  id: string
  /** 문서 전체에서의 등장 순서. 옛 번들에는 없다 */
  order?: number
  no: number
  labelEn: string
  labelKo: string
  ko: string
  en: string
  vocabHints: string[]
  categoryKey: string
  categoryTitle: string
  part: string
  audio: string | null
  audioDuration?: number
  sentences: SentencePair[]
  koAligned: boolean
}

export interface MockTest {
  no: number
  questions: string[]
  /** 문항별 음성의 번들 내 경로. 없으면 TTS로 출제 */
  audio?: (string | null)[]
  /** 문항별로 문서에 적혀 있는 답변·코칭 메모 (원문 그대로, 줄 단위) */
  answers?: string[][]
}

export interface MockSection {
  /** 기본 / 심화 */
  name: string
  tests: MockTest[]
}

export interface Manifest {
  version: 1
  createdAt: string
  student: string
  scripts: ManifestScript[]
  mockExam?: MockSection[]
}

/** DB에 저장되는 문장. sentenceId가 학습 기록의 영속 키다 */
export interface StoredSentence extends SentencePair {
  /** 정규화된 영어 문장의 해시. 재임포트해도 같은 문장이면 같은 id → SRS·녹음 유지 */
  sentenceId: string
}

export interface StoredScript extends Omit<ManifestScript, 'sentences'> {
  sentences: StoredSentence[]
}

export interface SrsEntry {
  sentenceId: string
  ease: number
  /** 다음 복습까지 간격(일) */
  interval: number
  dueAt: number
  reps: number
  lapses: number
}

export interface RecordingEntry {
  id: string
  sentenceId: string
  blob: Blob
  createdAt: number
  /** 녹음 길이(초). 예전 녹음에는 없을 수 있다 */
  duration?: number
  /** 3초 이상 말이 끊긴 횟수. 측정 전 녹음에는 없다 */
  pauses?: number
  /** 가장 길었던 공백(초) */
  longestPause?: number
  /** 전체 길이 중 실제 발화 비율 0~1 */
  speakingRatio?: number
}

/**
 * 사용자가 앱에서 직접 고친 문장. 원본과 별도로 저장되어
 * 새 번들을 가져와도 유지된다. 필드가 없으면 원본 그대로 표시.
 */
export interface SentenceEdit {
  sentenceId: string
  ko?: string
  en?: string
  updatedAt: number
}

/** 모의고사 답변의 사용자 수정본. key = "섹션-t테스트-q문항". 재임포트에도 유지 */
export interface MockAnswerEdit {
  key: string
  text: string
  updatedAt: number
}

/** 스크립트별 연습 횟수. 전체 재생 완주 또는 스피킹 연습 완료 시 +1 */
export interface PracticeEntry {
  scriptId: string
  count: number
  lastAt: number
}

/** 날짜별 연습 기록. key = "YYYY-MM-DD|scriptId" */
export interface PracticeDayEntry {
  key: string
  /** YYYY-MM-DD (로컬 기준) */
  day: string
  scriptId: string
  count: number
}

export type Grade = 'again' | 'hard' | 'good'
