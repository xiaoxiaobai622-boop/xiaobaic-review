import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const EXPECTED: Array<{ file: string; calls: number }> = [
  { file: 'src/app/api/videos/[id]/download-token/route.ts', calls: 1 },
  { file: 'src/app/api/videos/[id]/download/route.ts', calls: 1 },
  { file: 'src/app/api/videos/[id]/assets/route.ts', calls: 1 },
  { file: 'src/app/api/videos/[id]/assets/[assetId]/route.ts', calls: 1 },
  { file: 'src/app/api/videos/[id]/assets/[assetId]/download-token/route.ts', calls: 1 },
  { file: 'src/app/api/videos/[id]/assets/download-zip-token/route.ts', calls: 1 },
  { file: 'src/app/api/videos/[id]/assets/download-zip/route.ts', calls: 1 },
  { file: 'src/app/api/videos/[id]/client-assets/route.ts', calls: 3 },
]

const failures: string[] = []
for (const item of EXPECTED) {
  let source = ''
  try {
    source = readFileSync(resolve(item.file), 'utf8')
  } catch {
    source = ''
  }
  const count = (source.match(/enforceShareVideoScope\s*\(/g) ?? []).length
  const ok = count >= item.calls
  console.log(`${ok ? 'PASS' : 'FAIL'} ${item.file} → ${count}/${item.calls} 个入口调用 scope 守卫`)
  if (!ok) failures.push(item.file)
}

if (failures.length > 0) {
  console.error(`\n视频 scope 守卫 ${failures.length} 个入口缺失`)
  process.exit(1)
}
console.log('\n视频 scope 守卫 8 个文件全部覆盖')
