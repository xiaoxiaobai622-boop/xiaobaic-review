# 公告系统验证记录

日期：2026-10-31（北京时间）。环境：本地 `localhost:3000` + Docker Postgres `vitransfer` / Redis；未写生产数据，未 commit/push/deploy。

## 结论

- 数据迁移、受众解析、生命周期、读/ACK/关闭/曝光回执、统计口径、权限边界均通过一次性脚本验证。
- 真实浏览器完成：发布台 → 受众预览 → 发布确认（全员 + 弹窗）→ 工作台弹窗/横幅 → ESC/遮罩/ACK → 收件箱 → 统计 → kill switch → CSV → 失败注入 → 390px 移动视口。
- `npx tsc --noEmit` 通过；`npx eslint <changed files>` 无输出；`impeccable detect --json` 返回 `[]`。
- 未运行 `npm run build`：当前 `next dev` 正占用 `.next`，避免覆盖正在使用的构建产物；静态检查与真实浏览器均通过。

## 交付物

- 设计/迁移/API 草案：`docs/announcements-system.md`
- 数据模型/迁移：
  - `prisma/migrations/20261031120000_add_announcement_system/migration.sql`
  - `prisma/migrations/20261031121500_backfill_announcement_read_events/migration.sql`
- 服务端域层：`src/lib/announcements/*`、`src/lib/announcement-feed-store.ts`
- 管理 API：`src/app/api/platform/announcements/**`
- 接收 API：`src/app/api/announcements/**`
- 发布台：`src/app/platform/announcements/**`、`src/components/announcements/AnnouncementForm.tsx`、`AnnouncementControlPanel.tsx`、`AnnouncementUi.tsx`
- 接收宿主：`src/components/announcements/AnnouncementHost.tsx`，挂在 `src/app/studio/layout.tsx`
- 收件箱：`src/components/RailNotifications.tsx`（类型徽标、展开写 READ、ACK、CTA、同 feed 数据）
- 验证脚本：
  - `scripts/announcements-seed.mts`（需要 `ANN_BROWSER_PASSWORD` 环境变量）
  - `scripts/announcements-verify.mts`
  - `scripts/announcements-cleanup.mts`
  - `scripts/check-announcement-regression.mts`（旧消息列表/反馈/feed 只读回归）

## 自动化验证（scripts/announcements-verify.mts，全部 PASS）

| 项 | 结果 |
| --- | --- |
| TEAM / ROLE / PLAN / FEATURE / LOCALE / ACTIVE_7D / INACTIVE_30D / NEVER_ACTIVE 解析人数 | 与直接 SQL 逐项一致 |
| FEATURE 默认开关 + 显式禁用 | 与 `isTeamFeatureEnabled` 语义一致（显式 grant 优先，否则 `defaultEnabled`） |
| EXCLUDE | 团队 5 人排除 1 人后 4 人 |
| 新成员当前可见 | 临时加入 Team A 后 active feed 含 Team A 公告 |
| 非受众隔离 | Team B 成员 active feed 不含 Team A 定向公告 |
| 时钟生命周期 | `SCHEDULED→ACTIVE`、`ACTIVE→EXPIRED`、`PAUSED→EXPIRED`，未来开始仍 `SCHEDULED` |
| READ/ACK/DISMISS | 重复调用幂等；事件各 1 条 |
| IMPRESSION | 同日事件去重；`shownCount` 按浏览器会话去重；`impressionCount` 跟随事件 |
| 关键公告 | ACK 前 `DISMISS` 返回 `ACK_REQUIRED`，ACK 后可关闭 |
| 跨模式状态 | 同一 feed 行带出 ACK/DISMISS，MODAL 写入后 INBOX 可见 |
| 统计 | 曝光/已读/已知晓/关闭与事件表对账；比率分母为当前受众 |
| 旧数据 | 旧公告 `MESSAGE/ACTIVE/INBOX`，旧 `readAt` 保留；legacy-style 新建走 schema 默认 |
| 权限 | 匿名平台 API 401；团队 token 平台 API 401；平台 token 200；匿名 feed 401；团队 token feed 200 |
| 旧路径回归（`scripts/check-announcement-regression.mts`） | `/api/platform/announcements?type=MESSAGE` 200 且保留 `id/title/content/createdAt/broadcast/targetName/readCount`；`/api/platform/feedback` 200；旧管理员 `/api/announcements` 200、仍含旧公告与 `readAt` 字段 |

## 真实浏览器证据

截图目录：`docs/screenshots/announcements/`

| 文件 | 内容 |
| --- | --- |
| `01-list-desktop.png` | 发布台桌面列表（迁移后的旧公告、受众快照/当前分列、控制条） |
| `02-preview-modal.png` | 发布前预览为收件人（弹窗） |
| `03-publish-confirm-all-modal.png` | 全员 + 弹窗发布确认，受众人数 20、ACK 必选、确认复选框 |
| `04-studio-modal-ack-required.png` | 工作台关键弹窗，焦点在「我已知晓」，背景 aria-hidden |
| `05-studio-banner-high-priority.png` | Team A 高优先级横幅 |
| `06-studio-banner-low-after-dismiss.png` | 高优先级横幅关闭后低优先级横幅接班 |
| `07-studio-inbox-expanded-ack.png` | 收件箱展开：类型徽标、CTA、已确认知晓 |
| `08-studio-mobile-modal.png` | 390×844 移动视口弹窗 |
| `09-studio-mobile-banner.png` | 390×844 移动视口横幅 |
| `10-platform-list-mobile.png` | 390×844 发布台列表 |
| `11-list-desktop-populated.png` | 有数据后的桌面列表与漏斗 |
| `12-detail-stats-desktop.png` | 公告详情：受众快照/当前、漏斗、按模式/按天、审计 |

浏览器行为记录：

- 全员 + 弹窗发布：服务端与 UI 都要求 `confirmAllModal`；确认框显示 20 人、弹窗、立即开始、需已知晓。
- 关键弹窗：ESC 不关闭；点击遮罩不关闭；只有「我已知晓」关闭并写入 READ+ACK。
- 横幅：同一时间只显示高优先级；高优先级关闭后低优先级才出现；两条关闭后重载不再出现。
- 收件箱：打开「平台」tab 写入 READ；旧「平台维护通知」与新公告同列表，类型徽标区分；展开弹窗公告显示「已确认知晓」。
- 统计模式筛选：同一公告 `mode=BANNER` 为曝光 1/关闭 1、已读 0；`mode=INBOX` 为已读 1、曝光 0；`mode=MODAL` 全 0。
- 时间筛选：`from=2026-11-01` 全部事件为 0。
- 受众类型筛选：`audienceKind=TEAM` 返回 5 条且每条都含 TEAM include 规则。
- CSV：200、`text/csv; charset=utf-8`、带 BOM、表头完整、9 行；不含邮箱等用户信息。
- Kill switch：开启后 Team A 横幅不出现（feed 正常、收件箱仍可见）；关闭后重载横幅出现；审计写入 KILL_SWITCH。
- 失败注入：对 `/api/announcements/state` 注入 500 后加载工作台，非关键弹窗 `dialogs=0` 不阻塞，标题仍出现在收件箱。
- 已发布不可改：对 ACTIVE 公告 PATCH 返回 `409 PUBLISHED_IMMUTABLE`。
- 测试发送：生成 `isTest=true`、受众 1、USER 规则、标题带 `[测试]` 的 ACTIVE 公告，并出现在工作台收件箱。
- 复制：旧 ACTIVE 公告复制为 `version=2` 的 DRAFT；旧版本保留审计。
- 暂停/恢复/归档：状态依次 PAUSED → ACTIVE → ARCHIVED；审计含 CREATE/PUBLISH/PAUSE/RESUME/ARCHIVE/COPY/TEST_SEND/KILL_SWITCH。
- 移动端：390×844 下弹窗可读、可滚动、可关闭；横幅可读；发布台列表转为卡片。

## 关键实现口径

- 一个 feed（`GET /api/announcements`）同时供 INBOX/BANNER/MODAL/TOAST；宿主只在客户端的 feed 上选一条 modal/一条 banner/一条 toast，不再每模式轮询。
- 受众在服务端解析：`count`/`sample` 走 SQL 语义；feed 用一次用户上下文 + 逐条规则 JS 匹配，不下发全量公告。LOCALE 取 `User.locale`，为空回落平台全局语言（当前没有每用户语言设置 UI，已在设计中标注）。
- 曝光/点击按“用户 + 公告 + 模式 + 北京日期”唯一；READ/ACK/DISMISS 按“用户 + 公告 + 类型”唯一。
- ACK 必选弹窗在未 ACK 前不受单条冷却/每日上限拦截，避免刷新绕过；kill switch 仍优先。
- 接收端 feed/read/state 限流按用户 ID；管理端仍按平台管理员边界与 IP 限流。
- 正文纯文本渲染；CTA/图片只允许 http/https 或站内相对路径；不含 `dangerouslySetInnerHTML`。

## P2 修补（第 2 轮）

### B-P2-1 列表 N+1

- 改前：发布台列表每行调用一次 `countAudience`。用 42 条本地 DRAFT 测量：12 行 → 14 次查询，42 行 → 44 次查询（测量脚本预热了 locale 缓存和 lifecycle throttle；生产首次请求若触发 lifecycle 同步会再恒定 +2，不随行数增长）。
- 改后：列表只查一次公告页 + 一次事件聚合，不再逐行解析当前受众；列表只显示发布时快照，详情页仍显示快照/当前。同一测量：12 行 → 2 次查询，42 行 → 2 次查询。
- 脚本：`scripts/announcements-query-count.mts`（setup / measure / cleanup，临时行全部为 DRAFT + isTest）。

### B-P2-2 历史分页

- `/api/announcements` 新增 `historyCursor` + `historyLimit`；首屏历史 50 条并返回 `historyNextCursor/historyHasMore`，收件箱“加载更多历史”走同一端点，不新增轮询器。
- 客户端 `historyExtra` 保留所有已加载的历史页；30 秒 refresh 时只替换首屏，再合并额外页，因此游标和已加载条目不回退。
- 本地 120 条 ARCHIVED 定向历史：首屏 50、3 页、120 条唯一；真实浏览器 DOM：50 → 100 → 120 行，30 秒轮询后仍 120 行，按钮消失。
- 脚本：`scripts/announcements-history-evidence.mts`（setup / verify / cleanup，临时用户无团队，其他账号不可见）。

### B-P2-3 事件保留/聚合

- 默认保留期 400 天，按 5000 条一批删除更早的 `AnnouncementEvent`；应用请求路径不删除事件。
- 实现：`src/lib/announcements/retention.ts`；脚本：`scripts/announcements-prune-events.mts`。默认 dry-run；`--apply` 需 `ANNOUNCEMENTS_PRUNE_CONFIRM=1`，非本地库还需 `ANNOUNCEMENTS_PRUNE_ALLOW_REMOTE=1`。
- 迁移 `20261031130000_add_announcement_event_occurred_at_index` 增加 `AnnouncementEvent(occurredAt)` 索引；本地 `prisma migrate status` 显示 124 个迁移且 schema up to date。
- 本地 dry-run：默认 400 天删除 0；`--days=1` 仅报告可删 1 条，未执行 apply，事件总数仍为 1。

### B-P2-4 未读语义

- 平台条目 `unread = !readAt`（服务端）；批注回复才使用浏览器水位。平台筛选标签改为“未读（服务端）”，团队为“未读（本机）”，并在平台页加说明“铃铛红点水位只用于批注回复”。
- “全部标记为已读”按当前分类执行：平台只写服务端 READ，团队只推进本地回复水位，不再互相污染。
- 浏览器实测：打开平台 tab 后首屏 50 条平台历史 `rowsStillShowingUnreadAfterOpen=0`，仍显示“未读（服务端）”和红点水位说明。
- 批量 READ 在客户端按 100 条分块，避免服务端单次上限导致 120 条历史只标记前 100 条。

## 本地复现

```bash
# 1) 重建本地种子（密码只走环境变量，不写文件）
ANN_BROWSER_PASSWORD='<local-only-password>' npx tsx scripts/announcements-seed.mts

# 2) 跑域层验证
npx tsx scripts/announcements-verify.mts

# 3) 旧消息/反馈/feed 回归（只读）
npx tsx scripts/check-announcement-regression.mts

# 4) 列表 N+1 前后证据
npx tsx scripts/announcements-query-count.mts setup
npx tsx scripts/announcements-query-count.mts measure 12
npx tsx scripts/announcements-query-count.mts measure 42
npx tsx scripts/announcements-query-count.mts cleanup

# 5) 历史分页 fixture
ANN_HISTORY_PASSWORD='<local-only-password>' npx tsx scripts/announcements-history-evidence.mts setup
npx tsx scripts/announcements-history-evidence.mts verify
npx tsx scripts/announcements-history-evidence.mts cleanup

# 6) 事件保留 dry-run（不要 --apply）
npx tsx scripts/announcements-prune-events.mts
npx tsx scripts/announcements-prune-events.mts --days=1

# 7) 清理本地测试数据（保留旧公告/旧已读）
npx tsx scripts/announcements-cleanup.mts

# 8) 静态检查
npx tsc --noEmit
npx eslint src/lib/announcements src/lib/announcement-feed-store.ts src/components/announcements src/app/api/announcements src/app/api/platform/announcements src/app/platform/announcements src/app/platform/layout.tsx src/app/platform/messages/page.tsx src/app/studio/layout.tsx src/components/RailNotifications.tsx scripts/announcements-seed.mts scripts/announcements-verify.mts scripts/announcements-cleanup.mts scripts/check-announcement-regression.mts scripts/announcements-query-count.mts scripts/announcements-history-evidence.mts scripts/announcements-prune-events.mts
```

> 种子/验证脚本只允许 `localhost/127.0.0.1` 的 `vitransfer` 库。清理只移除本次脚本/浏览器产生的种子用户与 `[浏览器验证]` 公告；并行会话创建的 `ACCUI-*` 测试公告未动，保留在原处。原有 2 条旧公告、旧已读与迁移回填的 1 条 READ 事件保留。

## 未验证/边界

- TOAST 承载代码已实现（低优先级、自动消失、会话去重），但本次未在浏览器中实际触发；TOAST 为可选项。
- 桌面客户端（Electron 外壳）未验证；本次是桌面浏览器 + 390×844 移动视口。
- 每用户语言偏好暂无 UI；LOCALE 受众对 `User.locale` 为空的人按平台全局语言解析。
- 旧公告没有发布时受众快照，列表/详情显示 `—`，当前解析数正常显示。
- 未运行 `npm run build`（避免覆盖正在运行的 dev `.next`）；上线前应在独立副本或停 dev 后跑一次。
- 能力边界：分享页访客、微信小程序、邮件/短信/飞书/系统推送、富文本/Markdown、A/B 实验均未纳入本期。
