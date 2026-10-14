import { unzipSync } from 'fflate'
import type { MockSection, MockTest } from './types.js'

/**
 * 여우오픽 모의고사 통합 엑셀을 파싱한다.
 *
 * 시트 구조: "모의고사 N" 제목 행 → 머리글 행(구분|Question|내용유형 분석|내답변)
 * → 문항 행들. 문항 음성은 없으므로 앱에서 TTS로 출제된다.
 * 내용유형 분석과 내답변은 그 문항의 답변 메모로 담아 스터디에서 그대로 보인다.
 */

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

/** <si> 블록 하나의 텍스트 (서식 분할된 <t> 조각들을 이어 붙인다) */
function siText(si: string): string {
  return decodeEntities(
    [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''),
  )
}

export function parseYeowooXlsx(data: Buffer): MockSection | null {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data)
  } catch {
    return null
  }
  const dec = new TextDecoder()
  const ssXml = entries['xl/sharedStrings.xml'] ? dec.decode(entries['xl/sharedStrings.xml']) : ''
  const shared = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => siText(m[1]))
  const sheetXml = entries['xl/worksheets/sheet1.xml']
  if (!sheetXml) return null

  /** 행 목록. 각 행은 열문자 → 셀 텍스트 */
  const rows: Map<string, string>[] = []
  for (const rowM of dec.decode(sheetXml).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = new Map<string, string>()
    for (const cellM of rowM[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellM[1]
      const col = attrs.match(/r="([A-Z]+)\d+"/)?.[1]
      if (!col) continue
      let text = ''
      const v = cellM[2].match(/<v>([\s\S]*?)<\/v>/)?.[1]
      if (/t="s"/.test(attrs)) text = shared[Number(v)] ?? ''
      else if (/t="inlineStr"/.test(attrs)) text = siText(cellM[2])
      else text = decodeEntities(v ?? '')
      text = text.trim()
      if (text) row.set(col, text)
    }
    if (row.size > 0) rows.push(row)
  }

  const tests: MockTest[] = []
  let test: MockTest | null = null
  /** 머리글 행에서 알아낸 열 배치 */
  let qCol = ''
  let typeCol = ''
  let ansCol = ''

  for (const row of rows) {
    const joined = [...row.values()].join(' ')

    const title = joined.match(/^모의고사\s*(\d+)/)
    if (title) {
      test = { no: Number(title[1]), questions: [], answers: [] }
      tests.push(test)
      continue
    }

    // 머리글 행: 열 위치를 기억한다
    if ([...row.values()].some((v) => v === 'Question')) {
      for (const [col, v] of row) {
        if (v === 'Question') qCol = col
        else if (/내용유형/.test(v)) typeCol = col
        else if (/내답변/.test(v)) ansCol = col
      }
      continue
    }

    if (!test || !qCol) continue
    const q = row.get(qCol)
    if (!q) continue
    test.questions.push(q)
    const notes: string[] = []
    const type = typeCol ? row.get(typeCol) : undefined
    if (type) notes.push(type)
    const ans = ansCol ? row.get(ansCol) : undefined
    if (ans) notes.push(...ans.split(/\r?\n/).filter(Boolean))
    test.answers!.push(notes)
  }

  const valid = tests.filter((t) => t.questions.length > 0)
  return valid.length > 0 ? { name: '여우', tests: valid } : null
}
