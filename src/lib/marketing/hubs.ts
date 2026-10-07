export type HubGroup = 'features' | 'compare'

/**
 * `/features` 与 `/compare` 唯一的文案表（三个字符串逐字来自计划 Task 7 Step 3，两页共用，
 * 不在页面文件里各写一份）。`blurb` 只当 `<h1>` 用；`title` 会套上根 layout 的 `%s | 逐帧审阅` 模板。
 * 列表里每条的标题与副文案不进这张表——它们直接读六篇文稿自己的 frontmatter `title` /
 * `description`。放在 lib 是因为 `/llms.txt` 这个纯文本路由也要用它。
 */
export const HUBS: Record<HubGroup, { title: string; description: string; blurb: string }> = {
  features: {
    title: '功能',
    description: '逐帧批注、版本记录、带密码的审片链接——影视团队交付时用得到的部分。',
    blurb: '交付一条片子会用到的几件事',
  },
  compare: {
    title: '对比',
    description: '和网盘微信、和分秒帧、和 Frame.io 的实质差异，含各自更适合的场景。',
    blurb: '现在这套流程哪里卡',
  },
}
