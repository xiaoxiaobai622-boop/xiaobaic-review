# 飞书通知 V1 交接报告

**交接日期**：2026-08-31
**当前上线版本**：`f44c0e3`（本地、GitHub main、生产服务器三方一致）
**生产地址**：https://mle6.cn

---

## 一、当前状态

| 项目 | 状态 |
|---|---|
| 本地 HEAD | `f44c0e3` |
| GitHub main | `f44c0e3` |
| 服务器运行镜像 | `ghcr.io/.../xiaobaic-review:f44c0e3...` |
| app / worker 容器 | 均 healthy |
| 磁盘占用 | 49%（剩余 29G）|
| 未提交文件 | 仅 `docs/` 下的文档 |

生产环境的飞书绑定已实测可用。

---

## 二、已实现功能

对照需求文档逐项：

| 需求条目 | 实现情况 |
|---|---|
| §3 个人中心绑定入口 | 个人中心「飞书通知」区块，显示绑定状态、飞书昵称，含解除绑定按钮 |
| §3.3 必须走官方 OAuth | 是，不接受手动填 open_id |
| §4 上传完成后提示绑定 | 已绑定不提示；未绑定显示提示条，可关闭，不阻塞上传 |
| §5 通知对象 = 视频上传者 | 是 |
| §6 逐帧审阅页推送入口 | 已有（位置和样式按你的要求保留现状）|
| §7/§8 本集 / 整个项目推送 | 两种范围都支持 |
| §9 推送确认窗口 | 显示项目、集数、批注数、接收人、飞书绑定状态 |
| §10 已推送状态提示 | 显示上次推送时间和批注数，「再次推送」默认不勾选 |
| §11 再次推送二次确认 | 是 |
| §12 只推未推送的批注 | 默认只推新增，弹窗内按集显示已推送/未推送 |
| §13 重新推送全部 | 勾选「再次推送」后可推全部，需二次确认 |
| §14 无批注时不调 API | 直接提示「暂无逐帧审阅批注意见，无需推送」|
| §15 上传者未绑定飞书 | 显示 ⚠️ 该用户尚未绑定飞书账号 |
| §16 一次推送一条汇总消息 | 是，不逐条发 |
| §21 通知记录 | 存 `FeishuNotification` 表 |
| §22 批注推送状态 | 通过通知记录反查，不改批注本身 |
| §23 保存与发送解耦 | 飞书失败不影响批注保存 |
| §25 解绑保留历史记录 | 只删绑定关系 |

此外按你的要求做的调整：项目推送只取每集**最新版本**（早期实现会把同一集的 v1、v2 都列出来），且**跳过没有批注的集数**。

### 数据模型

新增两张表：`FeishuBinding`（用户与飞书账号的绑定）、`FeishuNotification`（每次推送记录）。

**关键设计**：批注的「已推送/未推送」不写在 `Comment` 表上，而是通过 `FeishuNotification.commentIds` 数组反查得出。这样同一条批注可以被多次推送而不破坏原始数据（需求 §22）。

数据库迁移文件：`prisma/migrations/20260830154745_add_feishu_notification_models/`（已在生产执行）

---

## 三、代码清单

### 后端

| 文件 | 作用 |
|---|---|
| `src/lib/feishu.ts` | 飞书 API 客户端：tenant token 缓存、OAuth 换取用户信息、发送消息卡片 |
| `src/lib/deep-link.ts` | 生成卡片跳转链接，支持时间码定位 |
| `src/app/api/auth/feishu/authorize/route.ts` | 发起 OAuth，返回 `{ authUrl }` JSON |
| `src/app/api/auth/feishu/callback/route.ts` | OAuth 回调，写入绑定关系 |
| `src/app/api/feishu/binding/route.ts` | GET 查询绑定状态 |
| `src/app/api/feishu/unbind/route.ts` | POST 解除绑定（保留历史通知）|
| `src/app/api/feishu/push/[projectId]/preview/route.ts` | GET 推送预览 |
| `src/app/api/feishu/push/route.ts` | POST 执行推送 |

### 前端

| 文件 | 作用 |
|---|---|
| `src/components/FeishuPushButton.tsx` | 推送弹窗（预览、勾选、二次确认）|
| `src/components/FeishuBindingPrompt.tsx` | 上传完成后的绑定提示条 |
| `src/app/profile/page.tsx` | 个人中心飞书通知区块 |
| `src/components/VideoUploadModal.tsx` | 上传完成时挂载提示条 |
| `src/app/studio/projects/[id]/share/page.tsx` | 逐帧审阅页的推送入口 |

---

## 四、环境配置

### 服务器（`/opt/vitransfer/vitransfer-test/`）

`.env` 中已配置三个变量：

```
FEISHU_APP_ID=cli_aa1e85152d789be0
FEISHU_APP_SECRET=<已配置>
FEISHU_OAUTH_REDIRECT_URI=https://mle6.cn/api/auth/feishu/callback
```

`docker-compose.yml` 的 app 和 worker 服务都已在 `environment:` 段声明这三个变量。

**重要**：该文件的 `environment:` 是白名单机制，只有显式列出的变量才会传进容器。以后新增环境变量必须同时改 `.env` 和 `docker-compose.yml`，否则容器读不到。

`NEXT_PUBLIC_APP_URL` 未设置，代码走兜底值 `https://mle6.cn`，结果正确。

### 飞书开放平台

应用后台已把 `https://mle6.cn/api/auth/feishu/callback` 加入重定向 URL 白名单。

### 本地开发的已知问题

本地 `.env` 的 `FEISHU_OAUTH_REDIRECT_URI` 也指向 `https://mle6.cn/...`。这意味着**在本地点「绑定飞书」，授权后会跳转到生产环境，绑定关系写进生产数据库**。

若要本地独立测试绑定流程，需要两步：
1. 本地 `.env` 改为 `http://localhost:3000/api/auth/feishu/callback`
2. 飞书后台把这个地址也加进白名单（可与 mle6.cn 并存）

---

## 五、开发中踩过的坑（避免重复）

### 1. 授权返回 401 Unauthorized

**原因**：登录 token 存在 localStorage，靠 `apiFetch` 手动加 `Authorization` 头。而 `window.location.href = '/api/...'` 是浏览器整页跳转，带不了这个头。

**解法**：authorize 接口不做服务端重定向，改为返回 `{ authUrl }`；前端用 `apiFetch` 拿到后再跳转。

### 2. 飞书返回错误码 20014

**原因**：`/authen/v1/oidc/access_token` 接口必须带 `Authorization: Bearer <tenant_access_token>`，否则飞书无法识别请求来自哪个应用。

**解法**：`exchangeCodeForUser` 里先调 `getTenantAccessToken()`，再带上该头。

### 3. 绑定后跳转到 localhost:4321

**原因**：回调里用 `new URL(path, request.url)` 构造重定向地址，容器内 `request.url` 解析为 `http://localhost:4321`，用户浏览器打不开。

**解法**：改用 `NEXT_PUBLIC_APP_URL`（兜底 `https://mle6.cn`）拼接绝对地址。

### 4. 预览接口 404

**原因一**：前端发 GET，后端只导出了 `POST`。
**原因二**：Next.js App Router 的动态路由必须是 `[projectId]/preview/route.ts` 这样的目录结构，文件名必须是 `route.ts`。

### 5. 部署健康检查超时导致自动回滚

**现象**：GitHub Actions 部署跑了 9 分钟后报 `dependency app failed to start` 并回滚。

**原因**：app 冷启动加上 102 个 Prisma 迁移检查，耗时超过健康检查窗口；worker 的 `depends_on: app healthy` 等不到就放弃，脚本判定失败。手动测 `/api/health` 返回 200，说明应用本身没问题。

**应急处理**（镜像已拉到服务器时，秒级完成）：

```bash
cd /opt/vitransfer/vitransfer-test
docker tag vitransfer-mps:fast vitransfer-mps:before-<旧版本>   # 备份当前
docker tag ghcr.io/xiaoxiaobai622-boop/xiaobaic-review:<新commit> vitransfer-mps:fast
docker compose up -d --force-recreate app worker
```

### 6. 改 .env 后容器读不到新变量

Docker 容器的环境变量在启动时固化。改完 `.env` 必须 `--force-recreate` 重建容器，`docker restart` 无效。

---

## 六、待验证 / 未完成事项

### 尚未实测的场景

| 场景 | 说明 |
|---|---|
| 飞书卡片实际收取 | 弹窗预览和推送接口已验证，但飞书里收到的卡片长什么样、跳转是否准确定位到时间码，尚未端到端测过 |
| 推送失败重试 | 需求 §23/§24 要求失败可重发。当前会把 `status` 写为 `FAILED` 并记录 `errorMessage`，但**没有重发的 UI 入口** |
| 解绑后重新绑定 | 需求 §26。代码逻辑支持，未实测 |
| 大量集数的展开查看 | 弹窗默认显示 5 集，超出折叠。集数很多时的表现未测 |

### 卡片文案与需求的差异

需求 §17 给的样例是纯文本格式：

```
项目：《XXX》
第03集
版本：V4
```

当前实现用了 Markdown 加粗（`**项目：**`）。飞书卡片支持 markdown，渲染出来是粗体标签 + 普通值，视觉上更清晰，但和需求文档的字面描述不完全一致。如果要严格对齐，改 `src/app/api/feishu/push/route.ts` 里的 `cardContent` 拼接即可。

### V1 明确排除的功能（需求 §28）

飞书多维表格同步、项目/剪辑/调色/字幕负责人自动匹配、飞书任务创建、在飞书内回复或修改批注状态、多接收人、群聊通知。这些都不在 V1 范围内。

---

## 七、日常操作手册

### 标准部署流程

```bash
# 1. 本地验证（这一步不能跳，Docker 构建失败会浪费 10 分钟）
cd /Users/xiaoxiaobai/code/xiaobaic-review
npm run build 2>&1 | tail -20
# 必须看到 "✓ Compiled successfully" 且无 "Failed to type check"

# 2. 提交推送
git add <改动的文件>
git commit -m "<描述>"
git push origin main

# 3. 等 CI 变绿（约 2 分钟），然后手动触发部署
# GitHub Actions → "Xiaobaic CI and Manual Deploy" → Run workflow
# → Branch: main → 勾选 confirm_production → Run workflow
```

### 排查问题的顺序

```bash
# 服务器跑的是哪个版本
docker inspect -f '{{.Image}}' vitransfer-app | cut -c8-19
docker images --format '{{.ID}} {{.Repository}}:{{.Tag}}' | grep <上面的ID> | grep ghcr

# 容器健康状况
docker ps --format '{{.Names}}\t{{.Status}}'

# 应用日志里的飞书相关错误
docker logs vitransfer-app --since 15m 2>&1 | grep -i feishu

# 容器内的飞书环境变量是否注入
docker exec vitransfer-app sh -c 'env | grep FEISHU'

# 数据库里的飞书表
docker exec vitransfer-postgres psql -U vitransfer -d vitransfer -c '\dt' | grep -i feishu
```

### 磁盘清理

历史镜像会累积，之前涨到过 100%。清理方法：

```bash
# Build cache（安全，服务器已改为拉取 GHCR 镜像，本地不再构建）
docker builder prune -af

# 历史镜像（保留当前运行版本和一个回退备份）
docker images --format '{{.ID}} {{.Repository}}:{{.Tag}}' \
  | grep -E 'ghcr.io|rollback-' \
  | grep -vE '^(<当前镜像ID>|<备份镜像ID>) ' \
  | awk '{print $2}' | xargs -r docker rmi
```

---

## 八、可以直接接着做的事

按优先级：

1. **端到端验证飞书卡片** — 真机点一次推送，确认卡片渲染和「查看本集」跳转能定位到正确时间码
2. **补失败重发入口** — 数据层已记录 `FAILED` 状态和错误原因，缺一个 UI 让用户点重发
3. **本地开发环境隔离** — 按第四节的方法把 `FEISHU_OAUTH_REDIRECT_URI` 改成 localhost，避免本地测试写生产库
4. **卡片文案对齐需求** — 如果要严格按需求 §17 的纯文本格式

需求原文保存在 `docs/FEISHU_NOTIFICATION_V1.md`。
