import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alignSentences } from './align.js'
import { carrySlashes, loadPreviousAnnotations, normalizeForCompare } from './annotate.js'
import { writeBundle } from './bundle.js'
import { categoryKey, parseScriptDoc } from './parseDocx.js'
import { scanMaterials } from './scan.js'
import { hasUnitMarks, splitScript } from './split.js'
import { transcribe } from './transcribe.js'
import type { BuiltScript, SourceFile } from './types.js'

const PREP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_ROOT = 'C:\\Users\\hatae\\Documents\\Claude\\Opic 1등급 도전'

/** prep/.env 를 읽어 환경변수로 올린다. dotenv 의존성 없이 단순하게 */
function loadEnv(): void {
  const envPath = join(PREP_DIR, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

interface Options {
  root: string
  /** 음성 인식·정렬을 건너뛰고 파싱 결과만 확인한다 */
  dry: boolean
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { root: process.env.OPIC_ROOT ?? DEFAULT_ROOT, dry: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry') opts.dry = true
    else if (argv[i] === '--root') opts.root = argv[++i]
  }
  return opts
}

/**
 * 오디오 파일명은 `하태용님 육하원칙 where (2).m4a` 형태다. 번호가 없으면
 * (`하태용님 인물묘사.m4a`) 카테고리 전체를 읽은 녹음이며 no=0 으로 들어온다.
 * 학생 이름·대단원·"스크립트" 같은 곁말은 무시하고 카테고리 이름이
 * 단어 경계로 포함되는지로 연결한다. 여러 카테고리가 걸리면 가장 긴 것을 택해
 * `who` 가 `when how often` 을 가로채지 않게 한다.
 */
function matchAudio(
  audioFiles: { file: SourceFile; base: string; no: number }[],
  keys: string[],
): Map<string, SourceFile> {
  const matched = new Map<string, SourceFile>()
  const used = new Set<string>()
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  for (const audio of audioFiles) {
    const base = categoryKey(audio.base)
    const hit = keys
      .filter((k) => new RegExp(`(^|\\s)${escape(k)}(\\s|$)`).test(base))
      .sort((a, b) => b.length - a.length)[0]
    if (!hit) continue
    const id = `${hit}#${audio.no}`
    used.add(audio.file.path)
    const prev = matched.get(id)
    if (!prev || audio.file.data.length > prev.data.length) matched.set(id, audio.file)
  }

  for (const audio of audioFiles) {
    if (!used.has(audio.file.path)) {
      console.warn(`  ! 어느 스크립트에도 연결되지 않은 오디오: ${audio.file.name}`)
    }
  }
  return matched
}

const fmt = (sec: number): string => {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}

async function main() {
  loadEnv()
  const opts = parseArgs(process.argv.slice(2))
  console.log(`자료 폴더: ${opts.root}\n`)

  const scan = scanMaterials(opts.root)
  console.log(
    `수업 폴더 DAY${scan.stats.days.join(', DAY')} · 파일 ${scan.stats.scanned}개 수집 → 중복 제거 후 ${scan.stats.unique}개`,
  )
  console.log(`스크립트 원본: ${scan.scriptDoc.path} (DAY${scan.scriptDoc.day})\n`)

  const doc = await parseScriptDoc(scan.scriptDoc.data)
  const keys = doc.categories.map((c) => c.key)
  const audioMap = matchAudio(scan.audioFiles, keys)

  const scripts: BuiltScript[] = []
  /** 번들 작성용: 스크립트 id → 오디오 원본 */
  const audioByScript = new Map<string, SourceFile>()

  // 새 워드에 `/` 가 빠져 있어도 (학원 파일로 덮어쓴 경우),
  // 문장 내용이 같으면 이전 번들에서 사용자의 단위 표시를 이어받는다
  const annotations = loadPreviousAnnotations()

  for (const category of doc.categories) {
    for (const s of category.scripts) {
      const id = `${category.key}#${s.no}`.replace(/\s+/g, '-')
      let en = s.en
      let carried = false
      // 단위 표시(볼드 / 또는 공백 붙은 /)가 없을 때만 이전 번들에서 이어받는다.
      // "배우/가수" 같은 원문 슬래시는 단위 표시가 아니다.
      if (!hasUnitMarks(en)) {
        const prev = annotations.get(id)
        if (prev && normalizeForCompare(prev) === normalizeForCompare(en)) {
          en = prev
          carried = true
        } else if (prev) {
          // 오타 수정 정도의 변경이면 / 위치를 새 문장으로 옮겨 심는다
          const migrated = carrySlashes(prev, en)
          if (migrated) {
            en = migrated
            carried = true
          } else {
            console.warn(
              `  ! ${category.title} ${s.no}) 내용이 많이 바뀌어 기존 / 단위를 이어받지 못했습니다. 워드에 / 를 다시 넣어주세요.`,
            )
          }
        }
      }
      const { sentences, koAligned, usedSlash } = splitScript(s.ko, en)
      if (carried) console.log(`  ↻ ${category.title} ${s.no}) ${s.labelEn}: 이전 / 단위 ${sentences.length}개 이어받음`)
      // 변형 전용 녹음이 없으면 카테고리 전체 녹음(#0)을 함께 쓴다
      const audio = audioMap.get(`${category.key}#${s.no}`) ?? audioMap.get(`${category.key}#0`) ?? null
      if (audio) audioByScript.set(id, audio)
      scripts.push({
        ...s,
        // 무번호 변형(배우/가수 등)은 영어 라벨이 없다. 앱 제목이 비지 않게 채운다
        labelEn: s.labelEn || s.labelKo,
        id,
        categoryKey: category.key,
        categoryTitle: category.title,
        part: doc.part,
        audio: audio ? audio.name : null,
        sentences,
        koAligned,
        unitSource: usedSlash ? 'slash' : 'auto',
      })
    }
  }

  console.log(`학생: ${doc.student} · 대단원: ${doc.part}`)
  console.log(`카테고리 ${doc.categories.length}개 · 스크립트 ${scripts.length}개\n`)

  // ---- 음성 인식 & 정렬 ----
  // 같은 녹음을 공유하는 스크립트들(카테고리 전체 녹음)은 한 번만 인식하고,
  // 문서 순서대로 이어붙인 문장 전체를 하나의 인식 결과에 정렬한다
  if (!opts.dry) {
    const groups = new Map<string, { file: SourceFile; scripts: BuiltScript[] }>()
    for (const s of scripts) {
      const file = audioByScript.get(s.id)
      if (!file) continue
      const g = groups.get(file.sha256) ?? { file, scripts: [] }
      g.scripts.push(s)
      groups.set(file.sha256, g)
    }
    for (const g of groups.values()) {
      const label =
        g.scripts.length === 1
          ? `${g.scripts[0].categoryTitle} ${g.scripts[0].no}) ${g.scripts[0].labelEn || g.scripts[0].labelKo}`
          : `${g.scripts[0].categoryTitle} 전체 (스크립트 ${g.scripts.length}개 공유)`
      process.stdout.write(`  🎙 ${label} … `)
      try {
        const tr = await transcribe(g.file)
        const combined = g.scripts.flatMap((x) => x.sentences)
        alignSentences(combined, tr)
        for (const x of g.scripts) x.audioDuration = tr.duration
        // 스크립트의 모든 문장이 매칭 실패면 녹음에 그 스크립트가 아예 없는 것이다
        // (예: 아직 녹음 안 된 응용 tip). 가짜 구간을 지우고 오디오 연결도 끊는다
        const unrecorded: string[] = []
        for (const x of g.scripts) {
          if (x.sentences.length > 0 && x.sentences.every((sn) => sn.needsReview)) {
            for (const sn of x.sentences) {
              delete sn.start
              delete sn.end
              delete sn.needsReview
            }
            x.audio = null
            x.audioDuration = undefined
            audioByScript.delete(x.id)
            unrecorded.push(x.labelEn || x.labelKo)
          }
        }
        const spanned = combined.filter((x) => x.start !== undefined)
        const review = spanned.filter((x) => x.needsReview).length
        console.log(`${fmt(tr.duration)} · 문장 ${combined.length}개` + (review ? ` · 확인필요 ${review}` : ''))
        for (const name of unrecorded) {
          console.log(`      ↳ ${name}: 녹음에 없는 스크립트로 판단, 오디오 연결 안 함`)
        }
      } catch (err) {
        console.log(`실패 (${(err as Error).message})`)
      }
    }
    console.log()
  }

  // ---- 요약 ----
  for (const category of doc.categories) {
    const own = scripts.filter((s) => s.categoryKey === category.key)
    console.log(`[${category.title}]`)
    for (const s of own) {
      const audio = s.audio ? '🔊' : '  '
      const ko = s.koAligned ? '' : '  ⚠ 한국어 미정렬'
      const spans = s.sentences.filter((x) => x.start !== undefined).length
      const timing = spans ? ` · 구간 ${spans}/${s.sentences.length}` : ''
      console.log(`  ${audio} ${s.no}) ${s.labelEn} – ${s.labelKo}  · 문장 ${s.sentences.length}개${timing}${ko}`)
    }
    console.log()
  }

  const withAudio = scripts.filter((s) => s.audio).length
  console.log(`오디오 연결: ${withAudio}/${scripts.length}`)
  const review = scripts.flatMap((s) => s.sentences).filter((x) => x.needsReview).length
  if (review) console.log(`확인 필요 문장: ${review}개 (앱에서 구간을 드래그로 보정할 수 있습니다)`)

  if (opts.dry) {
    console.log('\n--dry 모드이므로 음성 인식·번들 생성은 건너뜁니다.')
    return
  }

  const out = writeBundle(doc.student, scripts, audioByScript)
  console.log(`\n✅ 번들 생성: ${out}`)
  console.log('이 파일을 카톡 "나에게 보내기" 등으로 폰에 전송한 뒤, 앱에서 가져오기 하세요.')
}

main().catch((err) => {
  console.error(`\n실패: ${err.message}`)
  process.exitCode = 1
})
