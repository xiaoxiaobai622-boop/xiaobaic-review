# 平台公告系统：分类、状态机、承载、受众与口径

本文件是公告系统的设计交付与迁移/API 草案。实现顺序为：数据层与迁移 → 发布台 → 接收端 → 统计 → 治理。INBOX 是留档与兜底，不是第四种可选主模式；一条公告只有一个主承载。

## 1. 分类

| 类型 | 用途 | 允许主模式 | 说明 |
| --- | --- | --- | --- |
| `MESSAGE` | 个人消息，保留现有语义 | `INBOX` | 入队申请/审批结果等定向消息继续走这里 |
| `ANNOUNCEMENT` | 运营公告 | `INBOX` / `BANNER` / `MODAL` / `TOAST` | MODAL 需优先级 ≥ 50 |
| `RELEASE` | 版本说明 | `INBOX` / `BANNER` / `MODAL` / `TOAST` | MODAL 视为“重要版本” |
| `MAINTENANCE` | 维护 | `INBOX` / `BANNER` / `MODAL` | |
| `INCIDENT` | 故障 | `INBOX` / `BANNER` / `MODAL` | |
| `LEGAL` | 条款/隐私 | `INBOX` / `BANNER` / `MODAL` | 可要求 ACK |
| `PROMO` | 活动（可选） | `INBOX` / `BANNER` / `TOAST` | 不允许阻塞式 MODAL |

### 主承载

- `INBOX`：始终保留；窄栏「平台消息」可回看全部已投递公告（含暂停/过期/归档），也是任何承载失败时的兜底。
- `BANNER`：非阻塞，应用壳顶部；同一用户同一时间最多一条，按 `priority` 降序、再按发布时间降序选一条；关闭持久化。
- `MODAL`：阻塞；同一时间最多一个；仅高优先级/维护/故障/法务/重要版本；有全局每日上限、单条冷却与单用户最多次数。
- `TOAST`：可选，不阻塞；只允许低优先级（`priority ≤ 30`），自动消失、可关闭、同一会话去重。不为凑渠道而加。

模式约束在服务端校验：

- `MESSAGE` 只能是 `INBOX`，且受众必须是单个用户（兼容旧定向消息）。
- `MODAL` 仅允许 `ANNOUNCEMENT` / `RELEASE` / `MAINTENANCE` / `INCIDENT` / `LEGAL`，且 `priority ≥ 50`。
- `TOAST` 仅允许 `ANNOUNCEMENT` / `RELEASE` / `PROMO`，且 `priority ≤ 30`。
- `ackRequired` 仅允许 `MODAL` / `INBOX`，避免自动消失的 TOAST 变成无法完成确认的死路。

## 2. 生命周期状态机

状态：`DRAFT` → `SCHEDULED` → `ACTIVE` → `PAUSED` → `EXPIRED` → `ARCHIVED`。

```
DRAFT ──(立即发布)──────────────► ACTIVE
  │                                  │
  └──(定时发布, startAt > now)──► SCHEDULED
                                     │  (到点，惰性同步)
                                     ▼
ACTIVE ◄──(恢复)── PAUSED ◄──(暂停)── ACTIVE / SCHEDULED
  │                    │
  └──(endAt 到点)──────┴──────────► EXPIRED ──(归档)──► ARCHIVED
  └──(归档)──────────────────────────────────────────► ARCHIVED
```

规则：

- `DRAFT` 可编辑；发布后（`publishedAt` 非空，含 `SCHEDULED`）标题/正文/受众/模式/时间等业务字段不可静默修改。要改只能复制成新版本（`version + 1`，旧版本保留审计）。
- 发布时：`startAt` 为空或 ≤ 现在 → `ACTIVE`；`startAt > 现在` → `SCHEDULED`。`publishedAt` 对立即发布取当前时间，对定时发布取 `startAt`。
- 状态推进采用惰性同步：读取发布台/收件 feed 时，把到点的 `SCHEDULED` 改为 `ACTIVE`，把 `endAt` 已过的 `ACTIVE`/`PAUSED`/`SCHEDULED` 改为 `EXPIRED`。不新增后台调度依赖。
- `PAUSED` 不展示 BANNER/MODAL/TOAST，但已投递用户仍可在 INBOX 回看。
- `EXPIRED`/`ARCHIVED` 不再以 BANNER/MODAL/TOAST 弹出，但仍在 INBOX 留档。
- 删除不做常规操作；归档是终点。
- 时钟测试：非生产环境支持 `ANNOUNCEMENTS_NOW` 覆盖“现在”，用于跨开始/结束验证；生产环境忽略。

## 3. 受众

一条公告可以有多条受众规则，规则由 `kind + value + mode(INCLUDE/EXCLUDE)` 组成。

| audienceType | value | 解析 |
| --- | --- | --- |
| `ALL` | 空 | 全部用户 |
| `TEAM` | 团队 ID 列表 | 在该团队且成员状态 `ACTIVE` |
| `USER` | 用户 ID 列表 | 指定用户 |
| `ROLE` | `OWNER` / `ADMIN` / `MEMBER` | 在任一团队中具有该角色且成员 `ACTIVE` |
| `PLAN` | 套餐 key 列表 | 在任一 `ACTIVE` 团队且 `subscriptionPlan` 匹配 |
| `FEATURE` | 功能 key 列表 | 在任一 `ACTIVE` 团队；显式 grant 优先，无 grant 时取 `PlatformFeature.defaultEnabled`（与 `isTeamFeatureEnabled` 一致） |
| `LOCALE` | `zh` / `en` / `de` / `nl` | 用户 `locale`（为空时回落到平台语言设置）匹配 |
| `ACTIVE_STATUS` | `ACTIVE_7D` / `ACTIVE_30D` / `INACTIVE_7D` / `INACTIVE_30D` / `NEVER_ACTIVE` | 基于 `TeamMember.lastActiveAt` 与 `ACTIVE` 团队成员关系 |

组合语义：

- 多条 `INCLUDE` 规则之间是 OR。
- 任一 `INCLUDE` 为 `ALL` 时，基线是全员。
- `EXCLUDE` 规则在结果中做减法，优先于 include。
- 新公告发布时要求至少一条 `INCLUDE`；只写排除规则不能发布，避免误发全员。
- 旧数据没有规则时按旧语义解释：`userId` 有值 = 定向该用户；`userId` 为空 = 全员。
- 受众完全在服务端解析；接收端只收到自己可见的公告，不下发全量再前端过滤。
- 发布时写入受众数快照 `audienceCount` 与 `audienceResolvedAt`；列表只展示发布时快照，详情/统计同时展示快照和当前解析数，不混为一个数。列表不做逐行当前受众查询（避免 N+1），当前数在详情页解析。
- 预览返回当前解析人数 + 掩码样本（姓名、掩码邮箱/手机、团队名），用于发布前检查。
- `LOCALE` 说明：当前产品没有每用户语言设置 UI，`User.locale` 为空时回落到平台全局语言；这是已知限制，接入个人语言偏好后无需改公告模型。
- 活跃口径：`INACTIVE_*`/`NEVER_ACTIVE` 只统计至少有一个 `ACTIVE` 团队成员关系的用户，避免把没有团队的平台账号误算成“不活跃成员”。

## 4. 读、已知晓、关闭、曝光

同一条公告对同一个用户只有一行状态（`PlatformAnnouncementRead`，沿用旧表名以保留旧数据），跨 INBOX/BANNER/MODAL/TOAST 共享。

| 动作 | 写入 | 触发时机 | 幂等 |
| --- | --- | --- | --- |
| 曝光 `IMPRESSION` | `lastShownAt`、`shownCount`、`impressionCount` + 事件 | BANNER/MODAL/TOAST 实际展示 | 事件按 用户+公告+模式+北京日期 去重；`shownCount` 按会话去重 |
| 已读 `READ` | `readAt` + 事件 | 打开 INBOX / 展开正文 | 只写第一次 |
| 已知晓 `ACK` | `acknowledgedAt` + 事件；若未读同时补 `readAt` | 明确点「我已知晓」 | 只写第一次 |
| 点击 `CLICK` | 事件 | 点击 CTA | 按 用户+公告+模式+北京日期 去重 |
| 关闭 `DISMISS` | `dismissedAt` + 事件 | 用户主动关闭 BANNER/MODAL/TOAST | 只写第一次 |

关键公告（`ackRequired`）：

- 必须点「我已知晓」才能完成确认；X/ESC/点遮罩不能把它关掉；服务端 `DISMISS` 返回 `409 ACK_REQUIRED`。
- ACK 后视为已读（若之前没有 `readAt` 则补写）。
- 未 ACK 的弹窗在刷新/重挂载后仍会重新出现，不受单条冷却或每日上限拦截（否则用户可用刷新绕过 ACK）；全局 kill switch 仍然优先。
- 已 ACK 或已 DISMISS 的公告不再以 BANNER/MODAL/TOAST 弹出；INBOX 仍可回看。
- 已读不等于已知晓；已读也不阻止非关键 MODAL 按频率规则展示。

## 5. 统计口径

时区统一北京（UTC+8）。所有“未知”显示为 `—`，不写成 0；查询失败单独显示错误，不把失败渲染成零。

| 指标 | 定义 |
| --- | --- |
| 受众数（发布快照） | 发布时解析并落库的 `audienceCount` |
| 受众数（当前） | 现在按规则解析的人数 |
| 曝光次数 | `IMPRESSION` 事件数（按 用户+公告+模式+北京日期 去重） |
| 独立曝光人数 | 至少产生过一次 `IMPRESSION` 的去重用户数 |
| 已读人数 | `readAt` 非空的去重用户数 |
| 已知晓人数 | `acknowledgedAt` 非空的去重用户数 |
| 点击次数 / 人数 | `CLICK` 事件数（按日去重） / 去重用户数 |
| 关闭人数 | `dismissedAt` 非空的去重用户数 |
| 已读率 | 已读人数 / 当前受众数 |
| 已知晓率 | 已知晓人数 / 当前受众数 |
| 曝光率 | 独立曝光人数 / 当前受众数 |
| 点击率 | 点击人数 / 当前受众数 |
| 关闭率 | 关闭人数 / 当前受众数 |

事件表不会随 30 秒轮询增长：IMPESSION/CLICK 按用户+公告+模式+北京日期唯一；READ/ACK/DISMISS 按用户+公告+类型唯一。事件按公告/模式/日期建索引，并可按北京日期过滤。

事件保留策略：默认保留 400 天（`ANNOUNCEMENT_EVENT_RETENTION_DAYS`），由运维脚本 `scripts/announcements-prune-events.mts` 按批删除更早的事件（默认 dry-run；`--apply` 需要显式确认，远端库还需 `ANNOUNCEMENTS_PRUNE_ALLOW_REMOTE=1`）。实现见 `src/lib/announcements/retention.ts`，`AnnouncementEvent` 增加 `occurredAt` 索引。超出保留期的事件不再参与明细统计；应用请求路径不会自动删除事件。

## 6. 旧数据迁移

- `PlatformAnnouncement` 全部保留。
  - `type` → `MESSAGE`
  - `status` → `ACTIVE`
  - `primaryMode` → `INBOX`
  - `priority` → 0
  - `locale` → `zh`
  - `startAt` / `publishedAt` → 原 `createdAt`
  - `createdBy` → `NULL`（旧数据没有记录发送人）
  - `userId` 原样保留：有值继续定向该用户，空值继续全员。
  - 旧 `PlatformAnnouncementRead` 的 `readAt` 原样保留；`readAt` 改为可空（新状态行可以只有曝光/关闭而没有已读），旧行不受影响。
- `join-request-notifications` 继续写入 `MESSAGE / INBOX / ACTIVE / userId=目标用户`，语义不变。
- `/api/announcements` 保留旧字段（`id/title/content/createdAt/broadcast/readAt` + `unread`），新增字段为增量；旧客户端无需改。
- `/api/announcements/read` 保留，内部走新的 READ 逻辑。
- 发布台新公告不再使用 `userId` 作为受众字段，改用受众规则；旧接口 `POST /api/platform/announcements` 的 `{ target: ALL|USER, userId, title, content }` 继续可用，并按旧语义落成 `MESSAGE / INBOX`。

## 7. 数据模型（Prisma）

新增/扩展：

- `PlatformAnnouncement`：现有字段 + `locale/type/status/primaryMode/priority/startAt/endAt/ackRequired/ctaLabel/ctaUrl/imageUrl/createdBy/publishedAt/audienceCount/audienceResolvedAt/version/copiedFromId/isTest/archivedAt/updatedAt`。
- `PlatformAnnouncementRead`：现有 `readAt` 改可空 + `acknowledgedAt/dismissedAt/lastShownAt/shownCount/impressionCount/lastShownSessionId/updatedAt`。迁移时会为已有 `readAt` 补一条 `READ` 事件（`INBOX`），保证统计包含旧已读。
- `AnnouncementAudienceRule`：`announcementId/kind/value/mode`。
- `AnnouncementEvent`：`announcementId/userId/type/mode/beijingDay/dedupeKey/occurredAt`，`dedupeKey` 唯一。
- `AnnouncementAuditLog`：`announcementId?/actorUserId/actorLabel/action/detail(Json)/createdAt`。
- `AnnouncementControl`（单例 `global`）：`bannerModalPaused/modalMaxPerDay/modalCooldownMinutes/modalMaxShowsPerUser/toastMaxPriority/updatedBy`。
- `User.locale`：可空，用于 LOCALE 受众；为空回落全局语言。

关系：规则/事件随公告级联删除；审计的 `announcementId` 置空保留日志；用户的投递状态和事件随用户级联删除；受众规则/事件不做跨表外键到团队/套餐（只存值），避免团队删除后审计/历史失真。

## 8. API 草案

### 管理端（全部 `requirePlatformAuth`）

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/platform/announcements` | 列表：状态/类型/模式/受众类型/时间/搜索筛选；含发布时受众快照、统计计数、创建人（当前受众只在详情解析，避免逐行 N+1） |
| POST | `/api/platform/announcements` | 新建草稿；兼容旧 `{target,userId,title,content}` 直接发 MESSAGE |
| GET | `/api/platform/announcements/[id]` | 详情：内容、规则、快照/当前受众、统计、审计 |
| PATCH | `/api/platform/announcements/[id]` | 仅 DRAFT 可改；非 DRAFT 返回 `PUBLISHED_IMMUTABLE` |
| POST | `/api/platform/announcements/[id]/lifecycle` | `publish` / `pause` / `resume` / `archive` / `copy` / `test` |
| POST | `/api/platform/announcements/audience` | 受众预览：人数 + 掩码样本 |
| GET | `/api/platform/announcements/[id]/stats` | 单条统计：按模式/时间筛选、按天序列、漏斗 |
| GET | `/api/platform/announcements/export` | CSV 导出（公告维度，不含用户信息） |
| GET/PATCH | `/api/platform/announcements/control` | 全局 kill switch + 频率/冷却配置 |
| GET | `/api/platform/announcements/audit` | 全局审计（可选，详情已含最近记录） |

发布确认：

- 前端发布前显示受众数、主模式、开始/结束时间。
- `ALL + MODAL` 必须二次确认；服务端要求 `confirmAllModal: true`，否则 400，防止绕过 UI。
- 发布/暂停/恢复/归档/测试/复制/kill switch 写审计。

### 接收端（登录用户）

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/announcements` | 唯一 feed：当前用户可见公告 + 自己的 read/ack/dismiss/曝光状态 + 主模式/优先级 + kill switch/频率配置；INBOX/BANNER/MODAL/TOAST 共用，不再每模式一套轮询。`historyCursor`/`historyLimit` 取更早的 INBOX 历史（同一端点，游标式） |
| POST | `/api/announcements/state` | `{action: READ|ACK|DISMISS|IMPRESSION|CLICK, id/ids, mode, sessionId}` |
| POST | `/api/announcements/read` | 旧接口兼容，等价 READ 批量 |

feed 不返回全量公告再让前端过滤；服务端按用户上下文逐条匹配受众。首屏 active 上限 100 条，历史首屏 50 条并返回 `historyNextCursor`；收件箱“加载更多历史”只调用同一 `/api/announcements?historyCursor=...`，不新增轮询器。客户端刷新时保留已加载历史游标与条目，避免 30 秒轮询把分页进度冲回第一页。

### 失败回退

- feed 失败：宿主不渲染 BANNER/MODAL/TOAST，INBOX 保留上一次列表；登录/工作室不受阻塞。
- 受众解析/单条渲染异常：跳过该条，不阻塞其他公告。
- 状态写入失败：ACK/DISMISS 不乐观落库，提示重试；MODAL 保持打开。
- 公告不存在/无权查看：按不可见处理，不泄露标题/内容。
- BANNER 失败静默不显示；MODAL 失败回退 INBOX；新用户按当前受众解析，不依赖发布时的用户名单。

## 9. 各端出现位置

| 模式 | 端 | 位置 |
| --- | --- | --- |
| INBOX | studio / 团队后台 | 左侧窄栏「通知 → 平台」；公告与旧消息同列表，按类型徽标区分 |
| BANNER | studio / 团队后台 | 应用壳顶部固定条，不遮挡窄栏；同一时间最多一条 |
| MODAL | studio / 团队后台 | 应用壳覆盖层；Radix Dialog 焦点陷阱；最多一个 |
| TOAST | studio / 团队后台 | 右下角轻提示；自动消失；最多一个 |

分享页访客、微信小程序不在本期；以后要覆盖外部客户需另建受众模型，不能与登录用户公告混表。

## 10. 治理与安全

- 发布台只对 `isPlatformAdmin` 开放；所有管理 API 走 `requirePlatformAuth`，团队 token/匿名一律 401。
- 全员 + MODAL 双重确认（UI + 服务端确认字段）。
- 全局 kill switch 一键暂停所有 BANNER/MODAL/TOAST，INBOX 不受影响。
- 发布、暂停、恢复、归档、复制、测试发送、kill switch、控制参数变更留审计。
- 速率限制沿用现有 Redis 限流，并对测试发送/导出/控制参数收紧；接收端 feed/read/state 按用户 ID 限流，避免同一出口 IP 下的多个用户/标签页互相挤占。
- 不做默认双人审批。
- 正文纯文本渲染（`whitespace-pre-line`，不使用 `dangerouslySetInnerHTML`）；CTA 只允许 `http/https` 或站内相对路径（拒绝 `javascript:`、`data:`、`//host`）；图片同样只允许 `http/https` 或站内相对路径。
- 不支持 Markdown/富文本，避免 sanitize 缺口。

## 11. 验证计划

- 受众：ALL/TEAM/ROLE/PLAN/FEATURE/LOCALE/ACTIVE_STATUS 的预览人数与直接 SQL 一致；EXCLUDE 生效；新成员按当前规则可见；非受众的 active feed 不出现定向内容。
- 生命周期：DRAFT/SCHEDULED/ACTIVE/PAUSED/EXPIRED/ARCHIVED；`ANNOUNCEMENTS_NOW` 跨开始/结束；已发布内容 PATCH 被拒。
- 承载：最多一个 modal/一条 banner；优先级、频率、冷却；已 ack/dismiss 不再弹；INBOX 可回看；失败注入时 modal 不阻塞、banner 静默、inbox 仍可用。
- 回执：read/ack/dismiss 幂等；跨模式同一状态；关键公告无 ack 关闭被拒；统计与种子用户对账。
- 统计：事件数与状态数对账；按模式/受众/时间筛选；CSV 可打开、无敏感用户信息。
- 权限：非平台管理员打开页面/API 被拒；团队 token/匿名被拒；审计有记录；kill switch 生效。
- 回归：`/platform/messages` 反馈收件箱、RailNotifications、join-request 定向消息、旧公告与旧已读不受影响。
- 静态：`npx tsc --noEmit`；`npx eslint <changed files>`；确认 dev server 后再决定是否 build。
- 动态：真实浏览器从发布台 → 预览 → 发布 → inbox/banner/modal → 已读/已知晓 → 统计；桌面 + 一个移动端视口；截图/DOM 作为证据。
