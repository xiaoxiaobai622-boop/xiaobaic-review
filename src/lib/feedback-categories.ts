/**
 * 窄栏「提交反馈」那排类型标签的唯一出处：界面画它、接口认它、`PlatformFeedback.category`
 * 存的就是这里的字面量。分成两处写一定会漂——运营后台读的是库里那一列，界面改了措辞旧值不跟着变。
 *
 * 存标签本身而不是 slug：这一列只有运营后台在读，那边整页都是中文，多一张映射表只会多一处漏。
 */
export const FEEDBACK_CATEGORIES = [
  { key: '功能建议', hint: '你想要什么，用来完成什么工作' },
  { key: '交互建议', hint: '哪一步别扭，顺眼的话该是什么样' },
  { key: '问题反馈', hint: '哪一步、期望什么、实际发生什么' },
  { key: '卡顿缓慢', hint: '哪个页面、大概多久、在传多大的东西' },
  { key: '夸一句', hint: '哪一处好用，我们好留着' },
  { key: '其他', hint: '写下你想对平台说的话…' },
] as const

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]['key']

/** 接口层闸门：正文可以随便写，类型只能是这六枚之一（或者干脆没有）。 */
export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return FEEDBACK_CATEGORIES.some((row) => row.key === value)
}
