import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { unzipSync, zipSync } from 'fflate'
import { loadPreviousAnnotations, normalizeForCompare } from './annotate.js'
import { scanMaterials } from './scan.js'

/**
 * 번들에만 남아있는 `/` 단위 표시를 워드 원본에 직접 써넣는다.
 *
 * 학원의 새 파일로 워드를 덮어쓰면 사용자의 `/` 가 사라지고, 이어받기 기능이
 * 번들에서 복원해 주지만 워드 자체는 표시가 없는 상태로 남는다. 이 도구를 한 번
 * 돌리면 워드가 다시 완전한 원본이 된다.
 *
 * 실행: npm run prep:writeback  (워드에서 파일을 닫은 뒤)
 */

const DEFAULT_ROOT = 'C:\\Users\\hatae\\Documents\\Claude\\Opic 1등급 도전'

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

function encodeEntities(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** slashedEn 에서 `/` 가 놓인 위치를 "몇 번째 단어 뒤"로 환산한다 */
function boundaryTokenCounts(slashedEn: string): number[] {
  const counts: number[] = []
  let cum = 0
  const units = slashedEn.split('/').map((u) => u.trim()).filter(Boolean)
  for (const unit of units.slice(0, -1)) {
    cum += unit.split(/\s+/).length
    counts.push(cum)
  }
  return counts
}

/** 문단 텍스트에서 k번째 단어가 끝나는 문자 오프셋 (1-기반 k) */
function tokenEndOffsets(text: string): number[] {
  const ends: number[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) ends.push(m.index + m[0].length)
  return ends
}

/**
 * 문단 XML 안의 w:t 텍스트들에 지정 오프셋마다 " /" 를 삽입한다.
 * 오프셋은 문단 전체 텍스트(디코딩 기준)의 문자 위치.
 */
function insertIntoParagraph(paraXml: string, offsets: number[]): string {
  let cursor = 0
  const remaining = [...offsets].sort((a, b) => a - b)
  return paraXml.replace(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g, (_, open: string, body: string, close: string) => {
    const text = decodeEntities(body)
    const start = cursor
    cursor += text.length
    const hits = remaining.filter((o) => o > start && o <= cursor)
    if (hits.length === 0) return open + body + close
    let updated = text
    // 뒤에서부터 넣어야 앞쪽 오프셋이 밀리지 않는다
    for (const o of hits.reverse()) {
      const local = o - start
      updated = `${updated.slice(0, local)} /${updated.slice(local)}`
    }
    // 텍스트가 공백으로 시작/끝나면 워드가 지워버리지 않게 표시
    const needsPreserve = /^\s|\s$/.test(updated) && !/xml:space="preserve"/.test(open)
    const openTag = needsPreserve ? open.replace(/^<w:t/, '<w:t xml:space="preserve"') : open
    return openTag + encodeEntities(updated) + close
  })
}

function main(): void {
  const root = process.env.OPIC_ROOT ?? DEFAULT_ROOT
  const { scriptDoc } = scanMaterials(root)
  if (scriptDoc.path.includes('!')) {
    throw new Error(`스크립트 원본이 zip 안에 있어 수정할 수 없습니다: ${scriptDoc.path}`)
  }
  console.log(`워드 원본: ${scriptDoc.path}\n`)

  // 번들에서 주석을 가져온다. 정규화한 본문 → slashedEn
  const byText = new Map<string, string>()
  for (const slashedEn of loadPreviousAnnotations().values()) {
    byText.set(normalizeForCompare(slashedEn), slashedEn)
  }
  if (byText.size === 0) throw new Error('이어받을 / 단위가 없습니다. 번들을 먼저 생성하세요.')

  const entries = unzipSync(readFileSync(scriptDoc.path))
  const docXml = new TextDecoder().decode(entries['word/document.xml'])

  let written = 0
  let already = 0
  const newXml = docXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paraXml) => {
    const text = decodeEntities(
      [...paraXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(''),
    )
    if (text.includes('/')) {
      if (byText.has(normalizeForCompare(text))) already++
      return paraXml
    }
    const slashedEn = byText.get(normalizeForCompare(text))
    if (!slashedEn) return paraXml

    const ends = tokenEndOffsets(text)
    const offsets = boundaryTokenCounts(slashedEn).map((k) => ends[k - 1])
    if (offsets.some((o) => o === undefined)) {
      console.warn(`  ! 단어 수가 맞지 않아 건너뜁니다: ${text.slice(0, 50)}…`)
      return paraXml
    }
    written++
    console.log(`  ✎ / ${offsets.length}개 삽입: ${text.slice(0, 60)}…`)
    return insertIntoParagraph(paraXml, offsets)
  })

  if (written === 0) {
    console.log(already > 0 ? '모든 스크립트에 이미 / 가 있습니다. 수정할 것이 없습니다.' : '써넣을 문단을 찾지 못했습니다.')
    return
  }

  const backup = scriptDoc.path.replace(/\.docx$/i, `.${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.docx.bak`)
  copyFileSync(scriptDoc.path, backup)
  entries['word/document.xml'] = new TextEncoder().encode(newXml)
  writeFileSync(scriptDoc.path, zipSync(entries, { level: 6 }))
  console.log(`\n✅ 문단 ${written}개에 / 를 써넣었습니다.`)
  console.log(`백업: ${backup}`)
  console.log('워드에서 파일을 열어 확인해 보세요.')
}

try {
  main()
} catch (err) {
  const e = err as NodeJS.ErrnoException
  if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
    console.error('\n실패: 워드에서 파일이 열려 있습니다. 워드를 닫고 다시 실행해 주세요.')
  } else {
    console.error(`\n실패: ${e.message}`)
  }
  process.exitCode = 1
}
