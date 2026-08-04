/**
 * 스크립트는 (주제) (장소) (소요시간) 00 플레이스홀더가 든 템플릿이다.
 * OPIc은 주제가 랜덤으로 나오므로 같은 스크립트를 여러 주제로 바꿔 연습하는 게 핵심.
 */
export interface Topic {
  name: string
  /** (주제) 대입어 — 영어 */
  en: string
  /** (장소) 대입어 */
  placeEn?: string
  /** 00 (구체적 최애) 대입어 */
  favoriteEn?: string
}

export const TOPIC_PRESETS: Topic[] = [
  { name: '영화보기', en: 'watching movies', placeEn: 'movie theater', favoriteEn: 'action movies' },
  { name: '음악감상', en: 'listening to music', placeEn: 'concert hall', favoriteEn: 'K-pop' },
  { name: '조깅', en: 'jogging', placeEn: 'park', favoriteEn: 'running along the river' },
  { name: '카페가기', en: 'going to cafes', placeEn: 'cafe', favoriteEn: 'americano' },
  { name: '국내여행', en: 'traveling domestically', placeEn: 'beach', favoriteEn: 'Jeju island' },
  { name: '공원가기', en: 'going to the park', placeEn: 'park', favoriteEn: 'having a picnic' },
]

const PLACEHOLDER = /\((주제|장소|소요시간)\)|00/g

/** 플레이스홀더를 하이라이트 마크업 없이 텍스트로 대입한다 */
export function substitute(text: string, topic: Topic | null): string {
  if (!topic) return text
  return text.replace(PLACEHOLDER, (m) => {
    if (m === '(주제)') return topic.en
    if (m === '(장소)') return topic.placeEn ?? topic.en
    if (m === '00') return topic.favoriteEn ?? topic.en
    return m // (소요시간)은 스스로 채워 말하는 연습이 되도록 남겨둔다
  })
}

/** 화면 표시용: 플레이스홀더 위치를 분리해 하이라이트할 수 있게 쪼갠다 */
export function tokenize(text: string): { text: string; isPlaceholder: boolean }[] {
  const out: { text: string; isPlaceholder: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), isPlaceholder: false })
    out.push({ text: m[0], isPlaceholder: true })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), isPlaceholder: false })
  return out
}
