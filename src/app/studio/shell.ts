// Studio 壳层共用值。CSS 变量在 globals.css（--studio-sidebar-track-width / --studio-shell-gap）；
// 这里的数值只给需要算 px 的 JS 用，改宽度时两处一起改。
export const STUDIO_SIDEBAR_TRACK_PX = 288

// lg 起项目中心与项目详情共用这一块顶栏：同样的圆角、底色、内边距和下方 2px 缝。
// 高度不写死 —— 由同一套 py-4 加上右侧 31.88px 的控件行决定（两页实测 61.88）。
// 小于 lg 时两页各自保留移动端页头，不参与这套壳层。
export const STUDIO_HEADER_SHELL_CLASS =
  'lg:mb-[var(--studio-shell-gap)] lg:shrink-0 lg:flex-wrap lg:items-center lg:justify-between lg:gap-3 lg:rounded-[8px] lg:border-b-0 lg:bg-popover lg:px-3 lg:py-4'
