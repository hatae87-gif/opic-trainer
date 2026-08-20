/** 자료 폴더에서 수집한 파일 하나. zip 안에 들어있던 것도 동일하게 취급한다. */
export interface SourceFile {
  /** 표시용 경로. zip 내부 파일은 "DAY2(260731)/자료.zip!하태용님 who (1).m4a" 형태 */
  path: string
  /** 파일명만 (확장자 포함) */
  name: string
  /** 이 파일이 속한 수업 회차. DAY 폴더명에서 추출 */
  day: number
  /** 수업 날짜 YYMMDD */
  date: string
  /** 파일 수정 시각(ms). zip 내부 파일은 zip 자체의 수정 시각 */
  mtime: number
  data: Buffer
  sha256: string
}

/** 오디오 파일명에서 뽑아낸 정보. `하태용님 육하원칙 where (2).m4a` */
export interface AudioRef {
  file: SourceFile
  /** 대단원. 예: 육하원칙 */
  part: string
  /** 카테고리 정규화 키. 예: "where", "when how often" */
  categoryKey: string
  /** 변형 번호. 예: 2 */
  no: number
}

/** 워드에서 파싱한 스크립트 1개 (= 카테고리 안의 변형 1개) */
export interface ParsedScript {
  /** 변형 번호 */
  no: number
  /** 영어 라벨. 예: "Far from my place" */
  labelEn: string
  /** 한국어 라벨. 예: "멀어" */
  labelKo: string
  /** 한국어 본문 (문단 원문) */
  ko: string
  /** 영어 본문 (문단 원문) */
  en: string
  /** `++` 블록의 보조 어휘 줄들 */
  vocabHints: string[]
}

export interface ParsedCategory {
  /** 워드에 적힌 그대로. 예: "When How often" */
  title: string
  /** 오디오 매칭용 정규화 키 */
  key: string
  order: number
  scripts: ParsedScript[]
}

export interface ParsedDoc {
  /** 학생 이름. 예: 하태용님 */
  student: string
  /** 대단원. 예: 육하원칙 */
  part: string
  categories: ParsedCategory[]
}

/** 문장 단위로 쪼갠 결과 */
export interface SentencePair {
  order: number
  en: string
  /** 한↔영 매칭이 실패하면 빈 문자열 */
  ko: string
  /** Whisper 정렬 후 채워짐 (초) */
  start?: number
  end?: number
  /** 정렬 신뢰도가 낮아 사람이 확인해야 하는 구간 */
  needsReview?: boolean
}

/** 번들 manifest에 들어가는 최종 스크립트 */
export interface BuiltScript extends ParsedScript {
  id: string
  /** 문서 전체에서의 등장 순서. 앱 홈 화면 정렬 기준 */
  order: number
  categoryKey: string
  categoryTitle: string
  part: string
  /** 번들 내 오디오 파일명. 오디오가 없으면 null */
  audio: string | null
  audioDuration?: number
  sentences: SentencePair[]
  /** 한국어 문장 수와 영어 문장 수가 맞지 않아 문장별 한국어를 못 붙인 경우 false */
  koAligned: boolean
  /** 단위 출처. slash = 사용자가 `/` 로 정한 단위 (이전 번들에서 이어받은 것 포함) */
  unitSource?: 'slash' | 'auto'
}

/** 모의고사 한 세트 (Test 1 = 15문항) */
export interface MockTest {
  no: number
  questions: string[]
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
  scripts: BuiltScript[]
  mockExam?: MockSection[]
}
