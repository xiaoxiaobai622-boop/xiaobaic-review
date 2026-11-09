import type { MarketingGroup } from './content'

export type HubGroup = MarketingGroup

/**
 * `/features` 与 `/compare` 唯一的文案表（三个字符串逐字来自计划 Task 7 Step 3，两页共用，
 * 不在页面文件里各写一份）。`blurb` 只当 `<h1>` 用；`title` 会套上根 layout 的 `%s | 逐帧审阅` 模板。
 * 列表里每条的标题与副文案不进这张表——它们直接读六篇文稿自己的 frontmatter `title` /
 * `description`。放在 lib 是因为 `/llms.txt` 这个纯文本路由也要用它。
 */
export const HUBS: Record<HubGroup, { title: string; seoTitle: string; description: string; metaDescription: string; blurb: string }> = {
  features: {
    title: '功能',
    // 只进 `<title>` 与 og:title。光写「功能 | 逐帧审阅」在结果页里不带任何品类词，
    // 搜「视频审片 功能」的人看不出这一条和他有关。
    seoTitle: '视频审片功能：逐帧批注、版本记录与审片链接',
    description: '逐帧批注、版本记录、带密码的审片链接——影视团队交付时用得到的部分。',
    metaDescription: '了解逐帧审阅的在线审片功能：用帧号和时间码收集视频批注，通过版本记录核对修改，再设置审片链接的密码、有效期与交付权限，让团队和客户按同一套流程推进到定稿。从第一版上传到定稿交付，功能页按批注、版本、链接与流程逐项说明；看片、留言、下载三项权限可按链接单独开关，通过由有管理权限的团队成员在对应版本确认，方便团队逐项核对。',
    blurb: '逐帧审阅功能总览：批注、版本与审片链接',
  },
  compare: {
    title: '对比',
    seoTitle: '视频审片工具对比与选型',
    description: '和网盘微信、和分秒帧、和 Frame.io 的实质差异，含各自更适合的场景。',
    metaDescription: '视频审片工具对比：从客户访问、时间码批注、版本管理和交付权限出发，阅读逐帧审阅与 Frame.io、分秒帧及网盘微信的差异说明，结合官方资料和团队实际流程选择。三个对比页分别交代国内访问、席位与数据归属、链接有效期等差别；其中 Frame.io 与分秒帧两页标注公开资料出处与核实日期，网盘微信页按实际流程问题说明差别。',
    blurb: '视频审片工具对比：找到适合团队的流程',
  },
  guides: {
    title: '指南',
    seoTitle: '在线审片指南：工具选型与客户协作',
    description: '从工具初选、团队试用到客户访问，先看流程与权限，再决定怎么用。',
    metaDescription: '阅读在线审片指南：按公开官方资料比较工具，用团队规模、版本管理和交付场景制定软件试用清单，并了解客户免注册审片时密码、邮箱验证码与游客权限的边界。三篇指南分别覆盖工具对照、软件选型和客户协作，给出一轮真实审片可执行的检查步骤。每篇都列出检查顺序与核对项，读完即可拿一条片子跑一轮审片，再决定是否采用。',
    blurb: '在线审片指南：选工具、跑流程、交付给客户',
  },
}
