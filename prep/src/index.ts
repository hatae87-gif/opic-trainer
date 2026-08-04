import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alignSentences } from './align.js'
import { writeBundle } from './bundle.js'
import { categoryKey, parseScriptDoc } from './parseDocx.js'
import { scanMaterials } from './scan.js'
import { splitScript } from './split.js'
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
 * 오디오 파일명은 `하태용님 육하원칙 where (2).m4a` 형태다.
 * 앞의 학생 이름·대단원은 무시하고, 끝부분이 카테고리 이름과 맞는지로 연결한다.
 * 여러 카테고리가 걸리면 가장 긴 것을 택해 `who` 가 `when how often` 을 가로채지 않게 한다.
 */
function matchAudio(
  audioFiles: { file: SourceFile; base: string; no: number }[],
  keys: string[],
): Map<string, SourceFile> {
  const matched = new Map<string, SourceFile>()
  const used = new Set<string>()

  for (const audio of audioFiles) {
    const base = categoryKey(audio.base)
    const hit = keys
      .filter((k) => base === k || base.endsWith(` ${k}`))
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

  for (const category of doc.categories) {
    for (const s of category.scripts) {
      const { sentences, koAligned } = splitScript(s.ko, s.en)
      const audio = audioMap.get(`${category.key}#${s.no}`) ?? null
      const id = `${category.key}#${s.no}`.replace(/\s+/g, '-')
      if (audio) audioByScript.set(id, audio)
      scripts.push({
        ...s,
        id,
        categoryKey: category.key,
        categoryTitle: category.title,
        part: doc.part,
        audio: audio ? audio.name : null,
        sentences,
        koAligned,
      })
    }
  }

  console.log(`학생: ${doc.student} · 대단원: ${doc.part}`)
  console.log(`카테고리 ${doc.categories.length}개 · 스크립트 ${scripts.length}개\n`)

  // ---- 음성 인식 & 정렬 ----
  if (!opts.dry) {
    for (const s of scripts) {
      const audio = audioByScript.get(s.id)
      if (!audio) continue
      process.stdout.write(`  🎙 ${s.categoryTitle} ${s.no}) ${s.labelEn} … `)
      try {
        const tr = await transcribe(audio)
        alignSentences(s.sentences, tr)
        s.audioDuration = tr.duration
        const review = s.sentences.filter((x) => x.needsReview).length
        console.log(`${fmt(tr.duration)} · 문장 ${s.sentences.length}개` + (review ? ` · 확인필요 ${review}` : ''))
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
