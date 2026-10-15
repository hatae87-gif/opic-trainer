import mammoth from 'mammoth'

/** 교재의 서론 가이드: 영어 질문 하나에 한국어 시작 멘트 1~2개 */
export interface StarterGuideEntry {
  question: string
  /** 한국어 서론 가이드 원문 (뒤의 "+ 육하원칙 …" 패턴 표기 포함) */
  starters: string[]
}

/** 회차 표시(10hr), 날짜, 섹션 별 등 가이드가 아닌 줄 */
const HARD_STOP = /^\d+\s*hr$|^✽|^✻|^Test\s*\d+/i

function hangulRatio(s: string): number {
  const letters = s.replace(/[^\p{L}]/gu, '')
  if (letters.length === 0) return 0
  return (letters.match(/[가-힣]/g)?.length ?? 0) / letters.length
}

/**
 * 서론 가이드로 인정하는 한국어 줄: 실제 발화를 흉내 낸 문장이다.
 * "음악? 어.." 처럼 리액션으로 시작하거나 "+ 육하원칙" 패턴 표기가 붙는다.
 * 코칭 안내문("원어민처럼 유창하게 발화하는 방법")은 그 특징이 없어 걸러진다.
 */
function isStarter(line: string): boolean {
  if (hangulRatio(line) < 0.3) return false
  // "1) 그 (주제) 어떻게..." 같은 질문 변형 안내는 발화 가이드가 아니다
  if (/^\d+\s*\)/.test(line)) return false
  return /\+\s*육하원칙|^.{0,25}\?|어\.\.|어…|글쎄|음\.\./.test(line)
}

/** 교재(수업 기록)에서 영어 질문 + 한국어 서론 가이드 쌍을 추출한다 */
export async function parseStarterGuide(buffer: Buffer): Promise<StarterGuideEntry[]> {
  const { value: html } = await mammoth.convertToHtml({ buffer })
  const flattened = html
    .replace(/<table[\s\S]*?<\/table>/gi, '')
    .replace(/<\/?(?:h[1-6]|li)\b[^>]*>/gi, (tag) => (tag.startsWith('</') ? '</p>' : '<p>'))
  const lines: string[] = []
  for (const m of flattened.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) lines.push(text)
  }

  const entries: StarterGuideEntry[] = []
  /** 같은 질문이 여러 회차에 다시 나오면 가이드를 합친다 */
  const byQuestion = new Map<string, StarterGuideEntry>()
  let current: StarterGuideEntry | null = null

  for (const line of lines) {
    // 질문: "- "로 시작하는 한글 없는 영어 의문문
    if (/^-\s/.test(line) && hangulRatio(line) === 0 && line.includes('?')) {
      const question = line.replace(/^-\s*/, '').trim()
      current = byQuestion.get(question) ?? null
      if (!current) {
        current = { question, starters: [] }
        byQuestion.set(question, current)
        entries.push(current)
      }
      continue
    }
    if (!current) continue
    if (HARD_STOP.test(line) || hangulRatio(line) < 0.3) {
      // 영어 줄이나 회차 경계가 나오면 이 질문의 가이드 수집을 멈춘다
      current = null
      continue
    }
    if (isStarter(line) && !current.starters.includes(line)) {
      current.starters.push(line)
    }
  }

  return entries.filter((e) => e.starters.length > 0)
}
