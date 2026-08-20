import mammoth from 'mammoth'
import type { MockSection, MockTest } from './types.js'

/** 섹션 제목: 기본 모의고사 / 심화 모의고사. "추가 모의고사 링크"에서 멈춘다 */
const SECTION = /^(기본|심화)\s*모의고사$/
const STOP = /^추가\s*모의고사/
const TEST_HEADER = /^Test\s*(\d+)$/i

/** 한글 음절 비율 */
function hangulRatio(s: string): number {
  const letters = s.replace(/[^\p{L}]/gu, '')
  if (letters.length === 0) return 0
  return (letters.match(/[가-힣]/g)?.length ?? 0) / letters.length
}

/**
 * 문항인지 판별한다.
 *
 * 심화 세트에는 문항 사이에 모범답안 메모가 끼어 있다. 메모는 말버릇 생략 부호(`..`),
 * 패턴 표시(`+`, `++`), 한국어 조각이 섞여 있어 이것으로 걸러낸다.
 * 실제 문항은 깔끔한 영어 문장으로 대부분 물음표를 포함한다.
 */
function isQuestion(line: string): boolean {
  if (hangulRatio(line) > 0.05) return false
  if (/\.\.|…|\+\+|\s\+\s|\s\+$/.test(line)) return false
  // 상황극 문항은 물음표가 없기도 하고, 인트로 문항("Tell me something about
  // yourself.")은 8단어가 안 되기도 한다
  return (
    line.split(/\s+/).length >= 8 ||
    line.includes('?') ||
    /^(tell|describe|pick|compare|let[’']?s)/i.test(line)
  )
}

export async function parseMockDoc(buffer: Buffer): Promise<MockSection[]> {
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
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/\s+/g, ' ')
      .trim()
    if (text) lines.push(text)
  }

  const sections: MockSection[] = []
  let section: MockSection | null = null
  let test: MockTest | null = null
  /** 목차(TOC) 영역은 건너뛴다: 첫 섹션 제목이 나올 때까지 PAGEREF 줄이 계속된다 */
  let inToc = true

  for (const line of lines) {
    if (/PAGEREF|Table of Contents|^TOC\b/i.test(line)) continue
    // 목차에도 같은 제목이 페이지 번호와 함께 등장하므로, 본문에 들어선 뒤에만 멈춘다
    if (!inToc && STOP.test(line)) break

    const sec = line.match(SECTION)
    if (sec) {
      inToc = false
      section = { name: sec[1], tests: [] }
      sections.push(section)
      test = null
      continue
    }
    if (inToc || !section) continue

    const t = line.match(TEST_HEADER)
    if (t) {
      const no = Number(t[1])
      // 같은 Test 제목이 연달아 두 번 나오는 문서라 이미 있으면 재사용한다
      const existing = section.tests.find((x) => x.no === no)
      if (existing) test = existing
      else {
        test = { no, questions: [] }
        section.tests.push(test)
      }
      continue
    }

    if (test && isQuestion(line)) test.questions.push(line)
  }

  return sections.filter((s) => s.tests.some((t) => t.questions.length > 0))
}
