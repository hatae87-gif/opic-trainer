import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { unzipSync } from 'fflate'
import type { SourceFile } from './types.js'

const DAY_DIR = /^DAY(\d+)\((\d{6})\)$/i
/** DAY 폴더보다 항상 우선하는 정리본 폴더. 사용자가 직접 다듬은 자료가 들어간다 */
const CURATED_DAY = 999
const AUDIO_EXT = /\.(m4a|mp3|wav|mp4|aac)$/i
const SCRIPT_DOC = /모든\s*스크립트.*\.docx$/i
const MOCK_DOC = /모의고사.*\.docx$/i
/** 교재는 스크립트가 아니라 수업용 책이므로 제외한다 */
const TEXTBOOK_DOC = /교재/i
/** 워드 잠금 파일(~$...), 임시 파일, writeback 백업 등 */
const JUNK_FILE = /^~\$|\.tmp$|\.bak$|^\.|^Thumbs\.db$/i

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * zip 엔트리 이름이 CP949로 저장돼 있으면 fflate가 UTF-8로 읽어 깨뜨린다.
 * 깨진 흔적(U+FFFD)이 보이면 원래 바이트를 되살려 euc-kr로 다시 디코딩한다.
 */
function repairName(name: string): string {
  if (!name.includes('�')) return name
  try {
    const bytes = Uint8Array.from(name, (c) => c.charCodeAt(0) & 0xff)
    const decoded = new TextDecoder('euc-kr').decode(bytes)
    return decoded.includes('�') ? name : decoded
  } catch {
    return name
  }
}

function collectFromZip(zip: SourceFile): SourceFile[] {
  const out: SourceFile[] = []
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zip.data)
  } catch (err) {
    console.warn(`  ! zip을 열지 못했습니다: ${zip.path} (${(err as Error).message})`)
    return out
  }
  for (const [rawName, bytes] of Object.entries(entries)) {
    if (rawName.endsWith('/') || bytes.length === 0) continue
    const name = repairName(rawName)
    const data = Buffer.from(bytes)
    out.push({
      path: `${zip.path}!${name}`,
      name: basename(name),
      day: zip.day,
      date: zip.date,
      mtime: zip.mtime,
      data,
      sha256: sha256(data),
    })
  }
  return out
}

function walk(dir: string, day: number, date: string, out: SourceFile[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, day, date, out)
      continue
    }
    if (JUNK_FILE.test(entry.name)) continue
    const stat = statSync(full)
    if (stat.size === 0) continue
    const data = readFileSync(full)
    const file: SourceFile = {
      path: full,
      name: entry.name,
      day,
      date,
      mtime: stat.mtimeMs,
      data,
      sha256: sha256(data),
    }
    if (/\.zip$/i.test(entry.name)) {
      out.push(...collectFromZip(file))
    } else {
      out.push(file)
    }
  }
}

export interface ScanResult {
  /** 가장 최근 수업의 마스터 스크립트 워드 파일 */
  scriptDoc: SourceFile
  /** 모의고사 문제집 (있으면) */
  mockDoc: SourceFile | null
  /** 오디오 후보. 카테고리 매칭은 파싱 결과를 알아야 하므로 여기서 하지 않는다 */
  audioFiles: { file: SourceFile; base: string; no: number }[]
  /** 진단용 */
  stats: { scanned: number; unique: number; days: number[] }
}

/**
 * 파일명에서 변형 번호를 떼어낸다. 번호 뒤에 설명 라벨이 붙기도 한다.
 * `... where (2).m4a` → base:"... where", no:2
 * `... where (2) - 멀어.m4a` → base:"... where", no:2
 * `... 인물묘사.m4a` (번호 없음) → no:0 — 카테고리 전체를 읽은 녹음
 */
function parseAudioName(name: string): { base: string; no: number } | null {
  const numbered = name.match(/^(.*?)\s*\(\s*(\d+)\s*\)\s*(?:[-–—]\s*.+?)?\s*\.[a-z0-9]+$/i)
  if (numbered) return { base: numbered[1].trim(), no: Number(numbered[2]) }
  const plain = name.match(/^(.*?)\s*\.[a-z0-9]+$/i)
  return plain ? { base: plain[1].trim(), no: 0 } : null
}

export function scanMaterials(root: string): ScanResult {
  const all: SourceFile[] = []
  const days: number[] = []

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const m = entry.name.match(DAY_DIR)
    if (m) {
      const day = Number(m[1])
      days.push(day)
      walk(join(root, entry.name), day, m[2], all)
    } else {
      // DAY 형식이 아닌 폴더(종합 등)는 사용자가 정리한 최신본으로 취급해
      // 어떤 DAY보다도 우선한다
      days.push(CURATED_DAY)
      walk(join(root, entry.name), CURATED_DAY, '', all)
    }
  }

  if (days.length === 0) {
    throw new Error(`수업 폴더를 찾지 못했습니다: ${root}`)
  }

  // 같은 파일이 폴더와 zip 양쪽에 중복 존재한다. 내용 해시로 하나만 남기되
  // 가장 나중 수업에서 나온 것을 남겨 날짜 정보가 최신이 되게 한다.
  const byHash = new Map<string, SourceFile>()
  for (const f of all) {
    const prev = byHash.get(f.sha256)
    if (!prev || f.day > prev.day) byHash.set(f.sha256, f)
  }
  const unique = [...byHash.values()]

  const docs = unique
    .filter((f) => SCRIPT_DOC.test(f.name) && !TEXTBOOK_DOC.test(f.name))
    // 누적 갱신 파일이므로 수정 시각이 가장 최근인 것을 원본으로 삼는다.
    // (사용자가 종합 폴더든 DAY 폴더든 어디에 넣어도 최신본을 찾는다)
    .sort((a, b) => b.mtime - a.mtime || b.day - a.day)

  if (docs.length === 0) {
    const candidates = unique.filter((f) => /\.docx$/i.test(f.name)).map((f) => f.name)
    throw new Error(
      `스크립트 워드 파일을 찾지 못했습니다. 발견된 .docx: ${candidates.join(', ') || '없음'}`,
    )
  }

  const audioFiles = unique
    .filter((f) => AUDIO_EXT.test(f.name))
    .map((f) => {
      const parsed = parseAudioName(f.name)
      return parsed ? { file: f, ...parsed } : null
    })
    .filter((x): x is { file: SourceFile; base: string; no: number } => x !== null)

  const mockDocs = unique
    .filter((f) => MOCK_DOC.test(f.name) && !TEXTBOOK_DOC.test(f.name))
    .sort((a, b) => b.mtime - a.mtime)

  return {
    scriptDoc: docs[0],
    mockDoc: mockDocs[0] ?? null,
    audioFiles,
    stats: { scanned: all.length, unique: unique.length, days: [...new Set(days)].sort((a, b) => a - b) },
  }
}
