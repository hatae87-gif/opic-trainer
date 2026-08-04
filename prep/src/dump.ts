import mammoth from 'mammoth'
import { scanMaterials } from './scan.js'

/** 학원이 워드 서식을 바꿨을 때 구조를 눈으로 확인하기 위한 진단용 스크립트 */
const root = process.env.OPIC_ROOT ?? 'C:\\Users\\hatae\\Documents\\Claude\\Opic 1등급 도전'
const { scriptDoc } = scanMaterials(root)
const { value: html } = await mammoth.convertToHtml({ buffer: scriptDoc.data })
console.log(html.replace(/<table[\s\S]*?<\/table>/gi, '\n[[표 생략]]\n').replace(/></g, '>\n<'))
