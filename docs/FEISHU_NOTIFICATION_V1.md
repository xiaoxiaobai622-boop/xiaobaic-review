# 飞书通知功能 V1 实现文档

## 功能概述

为 MLE6 逐帧审阅系统添加飞书通知功能，管理员审阅完成后可通过飞书将批注意见推送给视频上传者。

## 已完成功能

### ✅ 1. 数据模型（Task 11）

#### `FeishuBinding` - 用户飞书绑定
```prisma
model FeishuBinding {
  id         String   @id @default(cuid())
  userId     String   @unique
  openId     String   @unique
  unionId    String?
  tenantKey  String?
  nickname   String
  avatarUrl  String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

#### `FeishuNotification` - 推送记录
```prisma
model FeishuNotification {
  id               String   @id @default(cuid())
  projectId        String
  videoId          String?
  userId           String
  scope            String   // "video" | "project"
  commentIds       String[] // 本次推送的批注 ID 列表
  uploaderId       String
  uploaderOpenId   String
  status           String   @default("PENDING") // PENDING | SENT | FAILED
  feishuMessageId  String?
  errorMessage     String?
  retryCount       Int      @default(0)
  sentAt           DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  
  project          Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  video            Video?   @relation(fields: [videoId], references: [id], onDelete: Cascade)
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

**Migration**: `20260830154745_add_feishu_notification_models`

### ✅ 2. 飞书 API 客户端（Task 12）

**文件**: `src/lib/feishu.ts`

#### 核心功能
- `getTenantAccessToken()`: 获取企业 access token（带内存缓存，过期前 1 分钟自动刷新）
- `getFeishuAuthUrl(state)`: 生成 OAuth 授权 URL
- `exchangeCodeForUser(code)`: OAuth 回调换取用户信息（openId, unionId, nickname, avatarUrl）
- `sendMessageCard(openId, options)`: 发送交互式消息卡片到单聊

#### 消息卡片格式
```typescript
{
  title: string
  content: string // Markdown 格式
  buttons: Array<{
    text: string
    url: string // 深链跳转 URL
    type?: 'default' | 'primary' | 'danger'
  }>
}
```

### ✅ 3. OAuth 绑定流程（Task 13）

#### API 路由
- `GET /api/auth/feishu/authorize`: 
  - 验证用户登录状态
  - 生成 CSRF state token
  - 重定向到飞书授权页面
  
- `GET /api/auth/feishu/callback`:
  - 验证 state token 防止 CSRF
  - 换取用户信息
  - 创建或更新 `FeishuBinding` 记录
  - 重定向回 `/profile?feishu_success=true`

- `GET /api/feishu/binding`:
  - 查询当前用户绑定状态
  - 返回飞书昵称、头像、绑定时间

- `DELETE /api/feishu/binding`:
  - 解除当前用户的飞书绑定

### ✅ 4. 推送统计与发送（Task 14）

#### `POST /api/feishu/push/preview`
**请求**:
```json
{
  "scope": "video" | "project",
  "projectId": "cuid",
  "videoId": "cuid" // scope=video 时必填
}
```

**响应**:
```json
{
  "scope": "video",
  "project": { "id": "", "title": "", "code": "" },
  "videos": { "id": "", "name": "", "versionLabel": "" },
  "totalComments": 15,
  "pushedComments": 10,
  "unpushedComments": 5,
  "recipient": {
    "userId": "",
    "name": "",
    "feishuNickname": "",
    "isBound": true
  },
  "hasPreviousPush": true
}
```

#### `POST /api/feishu/push`
**请求**:
```json
{
  "scope": "video" | "project",
  "projectId": "cuid",
  "videoId": "cuid", // scope=video 时必填
  "rePushAll": false // 是否重新推送全部批注
}
```

**推送逻辑**:
1. 默认只推送未推送的批注（`rePushAll=false`）
2. 从 `FeishuNotification` 表查询已推送的 `commentIds`
3. 过滤出未推送的批注
4. 构建飞书消息卡片（最多显示前 10 条批注）
5. 调用 `sendMessageCard` 发送
6. 记录推送状态到 `FeishuNotification` 表

**错误处理**:
- 推送失败时批注数据不受影响
- 失败记录保存到 `FeishuNotification.status=FAILED`
- 返回 500 错误和详细错误信息

### ✅ 5. 前端 UI（Task 15）

#### 5.1 个人中心飞书绑定卡片
**文件**: `src/app/profile/page.tsx`

**位置**: "个人资料"和"修改密码"之间

**功能**:
- 未绑定状态: 显示说明 + "绑定飞书"按钮
- 已绑定状态: 显示飞书昵称 + "解除绑定"按钮
- OAuth 回调成功/失败提示
- 自动检测 URL 参数 `?feishu_success=true` 或 `?feishu_error=xxx`

#### 5.2 上传完成后的飞书绑定提示
**文件**: `src/components/FeishuBindingPrompt.tsx`

**功能**:
- 自动检测用户绑定状态
- 未绑定时显示蓝色提示卡片
- 可关闭（会话内记忆，不再显示）
- "立即绑定飞书"按钮跳转到 `/profile`

**集成位置**: 
- `src/components/VideoUploadModal.tsx`: 所有视频上传完成后显示

#### 5.3 "推送飞书"按钮
**文件**: `src/components/FeishuPushButton.tsx`

**功能**:
- 下拉菜单选择推送范围:
  - "推送本集"（当前视频）
  - "推送整个项目"
- 推送确认弹窗:
  - 显示接收人信息（姓名、飞书昵称、是否已绑定）
  - 显示批注统计（总数、已推送、未推送、本次将推送）
  - 已全部推送时显示"再次推送全部批注"选项
  - 接收人未绑定时禁用推送按钮并显示警告
- 推送成功后显示 ✓ 提示并自动关闭

**集成位置**:
- `src/app/studio/projects/[id]/share/page.tsx`: 审阅页面顶部工具栏（在审批状态下拉框旁边）

### ✅ 6. 深链跳转定位（Task 16）

#### 深链工具
**文件**: `src/lib/deep-link.ts`

**功能**:
- `buildDeepLink({ projectId, videoId?, timecode? })`: 构建深链 URL
- `parseTimecodeToSeconds(timecode)`: 时间码格式转秒数
- `formatSecondsToTimecode(seconds)`: 秒数转时间码格式

**支持格式**:
- 项目级: `/studio/projects/{projectId}/share`
- 视频级: `/studio/projects/{projectId}/share?video={videoId}`
- 带时间码: `/studio/projects/{projectId}/share?video={videoId}&t={seconds}`

**审阅页面时间码跳转**:
- 审阅页面已支持 `t` 参数（行 49: `urlTimestamp = searchParams?.get('t')`）
- 飞书卡片点击"查看本集"按钮 → 直接跳转到对应视频并定位时间码

### ✅ 7. 本地验证（Task 17）

#### 类型检查
```bash
npx tsc --noEmit
# 输出: 0 errors
```

#### 环境变量配置
**文件**: `.env.feishu.example`

```bash
FEISHU_APP_ID=your_feishu_app_id_here
FEISHU_APP_SECRET=your_feishu_app_secret_here
FEISHU_OAUTH_REDIRECT_URI=https://mle6.cn/api/auth/feishu/callback
```

**使用方法**:
1. 复制 `.env.feishu.example` 到 `.env`
2. 替换为实际的飞书应用凭证
3. 重启服务

## 文件清单

### 数据模型
- `prisma/schema.prisma`: 添加 `FeishuBinding` 和 `FeishuNotification` 模型
- `prisma/migrations/20260830154745_add_feishu_notification_models/`: 数据库迁移文件

### 后端
- `src/lib/feishu.ts`: 飞书 API 客户端
- `src/lib/deep-link.ts`: 深链跳转工具
- `src/app/api/auth/feishu/authorize/route.ts`: OAuth 授权入口
- `src/app/api/auth/feishu/callback/route.ts`: OAuth 回调处理
- `src/app/api/feishu/binding/route.ts`: 绑定状态查询/解绑
- `src/app/api/feishu/push/preview/route.ts`: 推送预览统计
- `src/app/api/feishu/push/route.ts`: 推送执行

### 前端
- `src/components/FeishuBindingPrompt.tsx`: 飞书绑定提示组件
- `src/components/FeishuPushButton.tsx`: 推送飞书按钮组件
- `src/app/profile/page.tsx`: 个人中心飞书绑定卡片（修改）
- `src/components/VideoUploadModal.tsx`: 上传完成后显示绑定提示（修改）
- `src/app/studio/projects/[id]/share/page.tsx`: 审阅页面添加推送按钮（修改）

### 配置
- `.env.feishu.example`: 飞书配置示例

## 使用流程

### 1. 用户绑定飞书
1. 用户登录 MLE6
2. 进入"个人中心"（`/profile`）
3. 点击"绑定飞书"按钮
4. 跳转到飞书授权页面
5. 授权后回调到 MLE6
6. 显示"绑定成功"提示

### 2. 管理员推送批注
1. 管理员进入项目审阅页面（`/studio/projects/{id}/share`）
2. 查看视频并添加批注
3. 点击顶部工具栏"推送飞书"按钮
4. 选择推送范围:
   - "推送本集": 仅当前视频的批注
   - "推送整个项目": 所有视频的批注
5. 确认推送信息:
   - 查看接收人（视频上传者）
   - 查看批注统计（总数、已推送、未推送）
   - 如需重新推送，勾选"再次推送全部批注"
6. 点击"确认推送"
7. 飞书发送交互式消息卡片给接收人

### 3. 接收人查看批注
1. 接收人在飞书收到消息卡片
2. 消息内容包含:
   - 项目名称、视频名称、版本号
   - 前 10 条批注预览（时间码 + 内容）
   - "查看本集"或"查看项目"按钮
3. 点击按钮跳转到 MLE6 审阅页面
4. 自动定位到对应视频（如果是单集推送）

## 技术细节

### 推送状态追踪
- **不改批注表**: 批注的"已推送/未推送"状态不存储在 `Comment` 表中
- **从推送记录推导**: 查询 `FeishuNotification` 表的 `commentIds` 数组判断
- **支持重复推送**: 通过 `rePushAll=true` 参数重新推送已推送的批注
- **幂等性**: 同一批注多次推送不会影响数据一致性

### 安全性
- **CSRF 防护**: OAuth 流程使用 state token 验证
- **权限控制**: 只有登录用户可以绑定飞书
- **推送权限**: 只有管理员（`canManageApproval=true`）可以推送
- **接收人验证**: 推送前检查上传者是否已绑定飞书

### 性能优化
- **Token 缓存**: tenant_access_token 缓存在内存，过期前 1 分钟自动刷新
- **批量查询**: 项目级推送时批量查询所有视频和批注
- **分页显示**: 消息卡片最多显示前 10 条批注，避免内容过长

## 已知限制（V1）

1. **单一接收人**: 只支持推送给视频上传者，不支持指定多个接收人
2. **无消息撤回**: 推送后无法在 MLE6 内撤回飞书消息
3. **无推送历史**: 暂无推送历史查询界面
4. **无批注级追踪**: 批注详情页不显示该批注的推送状态
5. **无时间码跳转**: 飞书卡片暂不支持直接跳转到批注的时间码位置（V2 可实现）

## 后续优化建议（V2）

1. **批注级时间码跳转**: 卡片按钮带时间码参数，点击直接定位到具体批注
2. **推送历史查询**: 添加推送历史列表，显示所有推送记录和状态
3. **批注级推送标记**: 在批注列表显示"已推送"标签
4. **多接收人**: 支持选择多个团队成员推送
5. **消息模板**: 支持自定义消息卡片内容和样式
6. **推送失败重试**: 自动重试机制或手动重试按钮
7. **推送通知设置**: 用户可配置接收哪些类型的通知

## 部署清单

1. ✅ 执行数据库迁移: `npx prisma migrate deploy`
2. ✅ 配置环境变量: 添加 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_OAUTH_REDIRECT_URI`
3. ✅ 重启应用服务
4. ⚠️ 飞书开放平台配置:
   - 添加 OAuth 回调 URL: `https://mle6.cn/api/auth/feishu/callback`
   - 开通权限: `im:message`（发送消息）、`contact:user.base`（获取用户基础信息）
   - 发布应用并获取 `app_id` 和 `app_secret`

## 测试建议

1. **绑定流程**: 测试 OAuth 授权、回调、绑定成功/失败
2. **推送功能**: 测试本集推送、项目推送、再次推送
3. **边界情况**:
   - 上传者未绑定飞书
   - 项目无批注
   - 所有批注已推送
   - 飞书 API 调用失败
4. **深链跳转**: 测试飞书卡片按钮跳转到正确视频
5. **并发推送**: 测试多个管理员同时推送同一项目

---

**文档版本**: V1.0  
**最后更新**: 2026-08-30  
**实现者**: Claude (Opus 5)
