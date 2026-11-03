import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateCommentAuthorName } from '../src/lib/comment-author-name'

const failures: string[] = []
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

const validNames = [
  '（测试）',
  '张三（导演）',
  'O’Connor',
  'A·B',
  'Jean-Luc',
  'Dr. Smith',
  '李_雷',
  '王　小明',
  '１２３',
  'x'.repeat(50),
]
for (const name of validNames) {
  const result = validateCommentAuthorName(name)
  check(result.valid, `应接受合法名字：${JSON.stringify(name)}`)
}

const trimmed = validateCommentAuthorName('  张三（导演）  ')
check(trimmed.valid && trimmed.name === '张三（导演）', '名字应去除首尾空格并保留全角括号')

const invalidNames = [
  '<script>',
  'a<b',
  'a>b',
  'Tom & Jerry',
  'a\u0000b',
  'a\u0007b',
  'a\nb',
  'a\tb',
  'a\u200Bb',
  'x'.repeat(51),
  '',
]
for (const name of invalidNames) {
  const result = validateCommentAuthorName(name)
  check(!result.valid, `应拒绝非法名字：${JSON.stringify(name)}`)
}

const helperSource = readFileSync(resolve('src/lib/comment-helpers.ts'), 'utf8')
check(helperSource.includes('validateCommentAuthorName('), '批注服务端校验必须调用共享的名字校验器')

if (failures.length > 0) {
  console.error(`\n批注作者名校验 ${failures.length} 项不满足`)
  process.exit(1)
}
console.log(`\n批注作者名校验 ${validNames.length + 1 + invalidNames.length + 1} 项全部通过`)
