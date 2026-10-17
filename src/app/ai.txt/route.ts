import { GET as renderLlmsTxt } from '@/app/llms.txt/route'

export const dynamic = 'force-dynamic'

/**
 * 同一份站点目录，再挂一个文件名。
 *
 * 10-17 生产访问日志里 `SEOJuice-SearchBot` 连着三次打 `/ai.txt` 拿到 404：`ai.txt` 是
 * `llms.txt` 之外另一条已被抓取工具实现的目录约定，两家读的文件名不同、要的内容一样。
 * 这里转发到同一个 handler，而不是抄第二份——两份目录一定会在改稿时错开。
 */
export async function GET() {
  return renderLlmsTxt()
}
