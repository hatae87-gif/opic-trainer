import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import type { BuiltScript, Manifest, MockSection, SourceFile } from './types.js'

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'output')

/**
 * manifest + 오디오를 .opicpack(zip) 하나로 묶는다.
 * 이 파일 하나만 폰으로 보내면 앱이 통째로 가져간다.
 */
export function writeBundle(
  student: string,
  scripts: BuiltScript[],
  audioByScript: Map<string, SourceFile>,
  mockExam?: MockSection[],
): string {
  const entries: Record<string, Uint8Array> = {}
  for (const s of scripts) {
    if (!s.audio) continue
    const file = audioByScript.get(s.id)
    if (!file) continue
    // 내용 해시로 이름을 정한다: ASCII 강제(한글 인코딩 문제 회피) +
    // 카테고리 전체 녹음을 여러 스크립트가 공유해도 zip에는 한 번만 들어간다
    const safeName = `audio/${file.sha256.slice(0, 16)}.m4a`
    s.audio = safeName
    entries[safeName] = file.data
  }

  // manifest는 audio 필드가 zip 엔트리 이름으로 바뀐 뒤에 직렬화해야 한다
  const manifest: Manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    student,
    scripts,
    ...(mockExam && mockExam.length > 0 ? { mockExam } : {}),
  }
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 1))

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const outPath = join(OUTPUT_DIR, `opic-${stamp}.opicpack`)
  writeFileSync(outPath, zipSync(entries, { level: 6 }))
  return outPath
}
