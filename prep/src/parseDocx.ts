import mammoth from 'mammoth'
import type { ParsedCategory, ParsedDoc, ParsedScript } from './types.js'

/** 변형 헤더: `1) By myself – 혼자서` / `2) Far from my place - 멀어` */
const NUMBERED = /^(\d+)\s*\)\s*(.+)$/
/** 라벨을 영어/한국어로 가르는 구분자. en dash·em dash·하이픈 모두 쓰인다 */
const LABEL_SPLIT = /\s+[–—-]\s+/
/** `[ 육하원칙 정리표 ]` 같은 표 캡션 */
const CAPTION = /^\[(.+)\]$/
/** 보조 어휘 블록 시작 표시. 본문 안에도 `++` 가 나오므로 한 줄 통째일 때만 인정한다 */
const VOCAB_START = /^\+{2,}$/
/**
 * 카테고리처럼 보이지만 실제로는 안내 문구인 줄.
 * 이런 줄이 카테고리로 잡히면 바로 뒤의 진짜 스크립트가 엉뚱한 곳에 붙는다.
 */
const NOT_A_CATEGORY = [/^육하원칙으로\s*응용/, /^tip$/i]
/** 이 길이를 넘으면 제목이 아니라 본문 문단으로 본다 */
const BODY_MIN_LEN = 80

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

/** 한글 음절이 차지하는 비율. 한국어 본문과 영어 본문을 가르는 데 쓴다 */
function hangulRatio(s: string): number {
  const letters = s.replace(/[^\p{L}]/gu, '')
  if (letters.length === 0) return 0
  const hangul = letters.match(/[가-힣]/g)?.length ?? 0
  return hangul / letters.length
}

/**
 * 워드를 문단 목록으로 편다.
 *
 * 같은 문서 안에서도 변형 제목의 서식이 제각각이다. Who·What kind 는 제목 스타일(h3),
 * When·Where 는 굵게 처리한 일반 문단이다. 그래서 제목·목록·문단을 모두 같은 층위로
 * 펴서 읽는다. 표(정리표)는 스크립트가 아니라 요약이므로 통째로 걷어낸다.
 */
async function toParagraphs(buffer: Buffer): Promise<string[]> {
  const { value: html } = await mammoth.convertToHtml({ buffer })
  const flattened = html
    .replace(/<table[\s\S]*?<\/table>/gi, '')
    .replace(/<\/?(?:h[1-6]|li)\b[^>]*>/gi, (tag) => (tag.startsWith('</') ? '</p>' : '<p>'))

  const paragraphs: string[] = []
  for (const m of flattened.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decodeEntities(m[1].replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim()
    if (text) paragraphs.push(text)
  }
  return paragraphs
}

/** 오디오 파일명과 맞추기 위한 정규화. "When How often" → "when how often" */
export function categoryKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * 변형 제목인지 판단한다.
 *
 * `1) By myself – 혼자서` 처럼 번호가 붙는 게 보통이지만, 워드 자동 번호 매기기를 쓰면
 * 번호가 텍스트에 남지 않는다. 그래서 `영어 – 한국어` 라는 라벨 모양도 함께 인정한다.
 * 카테고리인 `상황극 – 질문하기` 는 왼쪽이 한국어라 여기 걸리지 않는다.
 */
function asVariantLabel(line: string): { no: number | null; labelEn: string; labelKo: string } | null {
  const numbered = line.match(NUMBERED)
  const body = numbered ? numbered[2] : line
  const parts = body.split(LABEL_SPLIT)
  if (parts.length < 2) {
    return numbered ? { no: Number(numbered[1]), labelEn: body.trim(), labelKo: '' } : null
  }
  const labelEn = parts[0].trim()
  const labelKo = parts.slice(1).join(' - ').trim()
  if (!numbered) {
    const looksLikeVariant =
      hangulRatio(labelEn) < 0.15 && /[a-z]/i.test(labelEn) && hangulRatio(labelKo) >= 0.5
    if (!looksLikeVariant) return null
  }
  return { no: numbered ? Number(numbered[1]) : null, labelEn, labelKo }
}

export async function parseScriptDoc(buffer: Buffer): Promise<ParsedDoc> {
  const lines = await toParagraphs(buffer)
  if (lines.length === 0) throw new Error('워드에서 문단을 하나도 읽지 못했습니다.')

  const student = lines[0]
  // 대단원 제목은 표 안에 들어있어 문단으로 잡히지 않는다. 표 캡션에서 되살린다.
  const caption = lines.find((l) => CAPTION.test(l))?.match(CAPTION)?.[1] ?? ''
  const part = caption.replace(/\s*정리표\s*$/, '').trim()

  const categories: ParsedCategory[] = []
  let current: ParsedCategory | null = null
  let script: ParsedScript | null = null
  let vocabMode = false
  /** 현재 변형에 딸린 본문 문단들. 한/영 판별은 다 모은 뒤에 한다 */
  let bodies: string[] = []

  const flushScript = () => {
    if (!script) return
    script.ko = bodies.filter((b) => hangulRatio(b) >= 0.15).join(' ')
    script.en = bodies.filter((b) => hangulRatio(b) < 0.15).join(' ')
    if (script.en) current?.scripts.push(script)
    else console.warn(`  ! 영어 본문이 없어 건너뜁니다: ${current?.title} ${script.labelEn}`)
    script = null
    bodies = []
    vocabMode = false
  }

  for (const line of lines.slice(1)) {
    if (CAPTION.test(line)) continue

    if (VOCAB_START.test(line)) {
      vocabMode = true
      continue
    }

    const isBody = line.length >= BODY_MIN_LEN
    const variant = isBody ? null : asVariantLabel(line)

    if (vocabMode) {
      // 어휘 줄(`Good, Great, Nice, …`)은 짧아서 카테고리 제목과 생김새가 비슷하다.
      // 쉼표로 나열되지 않은 짧은 줄만 제목으로 보고 어휘 블록을 끝낸다.
      const looksLikeHeading = !isBody && line.length <= 30 && !line.includes(',')
      if (variant || isBody || looksLikeHeading) vocabMode = false
      else {
        script?.vocabHints.push(line)
        continue
      }
    }

    if (variant) {
      flushScript()
      script = {
        // 번호가 텍스트에 없으면 카테고리 안 등장 순서를 번호로 삼는다.
        // 오디오 파일명의 (1) (2) 도 같은 순서이므로 이렇게 해야 서로 맞는다.
        no: variant.no ?? (current?.scripts.length ?? 0) + 1,
        labelEn: variant.labelEn,
        labelKo: variant.labelKo,
        ko: '',
        en: '',
        vocabHints: [],
      }
      continue
    }

    if (isBody) {
      if (script) bodies.push(line)
      else console.warn(`  ! 어느 변형에도 속하지 않은 본문을 건너뜁니다: ${line.slice(0, 40)}…`)
      continue
    }

    // 남은 짧은 줄 = 카테고리 제목
    flushScript()
    if (NOT_A_CATEGORY.some((re) => re.test(line))) continue
    current = { title: line, key: categoryKey(line), order: categories.length, scripts: [] }
    categories.push(current)
  }
  flushScript()

  return {
    student,
    part,
    // 아직 수업에서 다루지 않아 비어있는 카테고리는 내보내지 않는다.
    // 다음 수업에 내용이 채워지면 자동으로 나타난다.
    categories: categories.filter((c) => c.scripts.length > 0),
  }
}
