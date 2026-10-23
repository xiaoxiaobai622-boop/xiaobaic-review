/**
 * 首页首屏演示视频走对象存储 + CDN（2026-10-23 上传），不再随镜像发布——
 * 整段 46.8s 的录屏有 2MB，放在 public 里等于每次部署都多背一份。
 * 域名为生产 `MEDIA_CDN_BASE_URL`（https://media.vidx.cn）；CSP 的 media/img 在 proxy.ts 里放行。
 *
 * key 带内容 hash（sha256 前 8 位）：对象是 `Cache-Control: immutable`，换片必须换 key，
 * 否则老访客会一直看缓存里的旧片。换片流程＝改 fixtures 母版 → 重新压 → 传新 hash key → 改这一行。
 */
export const HOME_HERO_VIDEO_URL = 'https://media.vidx.cn/home/hero-b6cc37fa.mp4'
