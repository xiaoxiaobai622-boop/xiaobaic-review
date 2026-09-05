# 生产部署指南

> 本仓库要求通过 **Pull Request** 将代码合并到 `main` 分支，禁止直接推送。
> 仓库管理员需要在 GitHub 设置中为 `main` 启用分支保护规则，详见文末[分支保护设置](#分支保护设置)。

## 1. 当前部署架构

```text
本地修改并测试
    -> 推送开发分支到 GitHub
    -> 创建 Pull Request 合并到 main
    -> CI 自动验证（tsc / audit / build）
    -> 代码审查通过后合并
    -> 手动启动 GitHub Actions 生产部署
    -> GitHub 云端验证并构建 Docker 镜像
    -> 推送镜像到 GitHub Container Registry（GHCR）
    -> GitHub Actions 通过 SSH 连接生产服务器
    -> 服务器临时启用德国代理
    -> 从 GHCR 拉取镜像并执行 docker load
    -> 切换 app 和 worker 容器
    -> 连续健康检查
    -> 成功结束，或失败后自动回滚
```

这个流程不在本地构建镜像，也不在服务器编译源代码。Docker 镜像由 GitHub Actions 云端构建。

## 2. 当前环境信息

| 项目 | 当前值 |
|---|---|
| GitHub 仓库 | `https://github.com/xiaoxiaobai622-boop/xiaobaic-review` |
| 本地仓库 | `C:\Users\EDY\Documents\ChatGPT\网站\vitransfer-deploy-local` |
| 开发分支 | `codex/manual-production-deploy` |
| 生产分支 | `main` |
| Actions 工作流 | `.github/workflows/xiaobaic-ci-deploy.yml` |
| 生产网站 | `https://mle6.cn` |
| 服务器地址 | `111.229.35.33`，也可以使用 `mle6.cn` |
| SSH 用户 | `root` |
| 服务器应用目录 | `/opt/vitransfer/vitransfer-test` |
| GHCR 镜像 | `ghcr.io/xiaoxiaobai622-boop/xiaobaic-review:<提交 SHA>` |
| 服务器运行标签 | `vitransfer-mps:fast` |
| 业务容器 | `vitransfer-app`、`vitransfer-worker` |
| 德国代理监听 | `127.0.0.1:17890`，仅在服务器本机可访问 |

## 3. 部署前检查

打开 PowerShell：

```powershell
cd "C:\Users\EDY\Documents\ChatGPT\网站\vitransfer-deploy-local"
git status --short --branch
git branch --show-current
git log -1 --oneline
git remote -v
```

确认事项：

1. 当前目录必须是 `vitransfer-deploy-local`。
2. 只提交本次网站修改，不要把临时图片、测试输出、密钥或 `.env` 提交进去。
3. 不要将服务器生产代码目录与本地开发目录混合。
4. 不要使用 `git push --force` 覆盖 `main`。
5. 数据库结构发生变化时，必须先单独检查 Prisma migration；不能把未经确认的数据库迁移直接夹在普通界面部署中。

## 4. 本地验证

根据改动范围运行：

```powershell
npx tsc --noEmit --pretty false
git diff --check
npm run build
```

前端界面修改还应在本地开发网站中实际检查：

- 登录是否正常；
- 修改页面是否正常显示；
- 浅色和深色模式是否正常；
- 桌面端和移动端是否溢出；
- 视频播放、分享、上传等相关流程是否被影响。

如果测试未通过，停止推送和部署。

## 5. 提交代码

先查看具体修改：

```powershell
git status --short
git diff
```

只添加确定属于本次修改的文件：

```powershell
git add <文件1> <文件2>
git diff --cached
git commit -m "简短说明本次修改"
```

不要无条件执行 `git add .`，否则容易把临时文件一并提交。

## 6. 推送开发分支并创建 Pull Request

### 6.1 推送开发分支

```powershell
git push origin codex/manual-production-deploy
```

如果开发分支名不同，替换为实际分支名。

### 6.2 创建 Pull Request

在 GitHub 仓库页面创建 Pull Request：

```text
base: main
compare: codex/manual-production-deploy
```

PR 标题和描述应清楚说明本次修改内容、测试情况和部署影响。

### 6.3 等待 CI 通过和审查

- PR 创建后会自动触发 `Verify application` 任务。
- 检查 CI 是否全部通过。
- 至少一名 reviewer 批准后才能合并。
- 如果 CI 失败或审查不通过，先修复问题再重新请求审查。

### 6.4 合并到 main

审查通过且 CI 绿色后，使用 **Squash and merge** 或 **Create a merge commit** 合并到 `main`。

合并后 `main` 分支会包含本次提交的完整 SHA，用于后续生产部署。

## 7. 手动启动生产部署

### 方式 A：GitHub 网页

1. 打开仓库的 `Actions` 页面。
2. 选择 `Xiaobaic CI and Manual Deploy`。
3. 点击 `Run workflow`。
4. 分支选择 `main`。
5. 勾选 `Confirm deployment to the production website`。
6. 点击绿色的 `Run workflow`。
7. 如果 GitHub `production` Environment 显示等待审批，进入运行页面批准生产部署。

### 方式 B：GitHub CLI

```powershell
gh workflow run ".github/workflows/xiaobaic-ci-deploy.yml" `
  --repo xiaoxiaobai622-boop/xiaobaic-review `
  --ref main `
  -f confirm_production=true
```

查看最新运行：

```powershell
gh run list `
  --repo xiaoxiaobai622-boop/xiaobaic-review `
  --workflow ".github/workflows/xiaobaic-ci-deploy.yml" `
  --limit 5
```

实时查看指定运行：

```powershell
gh run watch <运行号> `
  --repo xiaoxiaobai622-boop/xiaobaic-review
```

## 8. GitHub Actions 自动执行的内容

### 阶段一：Verify application

GitHub 云端执行：

```text
npm ci --legacy-peer-deps
npm audit --omit=dev --audit-level=high
npm run build
```

任意一步失败，后续镜像构建和生产部署都不会执行。

### 阶段二：Build and push production image

GitHub Actions 使用 `Dockerfile` 构建 `linux/amd64` 镜像，并推送到：

```text
ghcr.io/xiaoxiaobai622-boop/xiaobaic-review:<完整提交 SHA>
```

每个生产版本使用完整 Git 提交号作为固定标签，不依赖含义不明确的 `latest`。

### 阶段三：Deploy to production

GitHub Actions 使用 SSH 连接服务器，然后执行：

1. 校验提交 SHA 和镜像地址；
2. 登录 GHCR；
3. 从 GitHub Secret 读取代理订阅；
4. 选择订阅中的第一个德国 VLESS 节点；
5. 生成临时 sing-box 配置并执行配置校验；
6. 将代理限制在服务器本机 `127.0.0.1:17890`；
7. 检查德国代理能否连接 `https://ghcr.io/v2/`；
8. 使用临时 GHCR 凭证目录和代理直接调用 `/usr/local/bin/crane pull` 拉取指定提交的镜像；
9. 使用 `docker load` 导入镜像；
10. 保存旧镜像回滚标签；
11. 将新镜像标记为 `vitransfer-mps:fast`；
12. 仅重建 `app` 和 `worker` 容器；
13. 执行连续健康检查。

网站、数据库、Redis、COS、CDN 和正常视频流量不会经过这个德国代理。该代理只用于服务器拉取 GHCR 镜像。

## 9. 健康检查和成功条件

部署只有同时满足以下条件才算成功：

- `vitransfer-app` 状态为 `healthy`；
- `vitransfer-worker` 状态为 `healthy`；
- worker 重启次数为 `0`；
- app 和 worker 都使用本次新镜像；
- worker 中的腾讯云 MPS 模板 ID 为 `1796772`；
- 上述状态连续稳定 30 秒；
- `https://mle6.cn/api/health` 请求成功。

生产网站入口：

```text
https://mle6.cn
```

## 10. 自动回滚

切换前，工作流会将当前生产镜像保存为：

```text
vitransfer-mps:rollback-<本次提交 SHA>
```

如果新容器启动或健康检查失败，工作流会：

1. 恢复部署前的 `.env`；
2. 将旧镜像重新标记为 `vitransfer-mps:fast`；
3. 重新创建 app 和 worker 容器。

镜像下载失败发生在容器切换之前，因此不会影响当前正在运行的生产网站。

## 11. GitHub Secrets

仓库需要配置以下 Secrets：

| Secret | 用途 |
|---|---|
| `SERVER_HOST` | 生产服务器地址 |
| `SERVER_USER` | SSH 用户名 |
| `SERVER_SSH_KEY` | GitHub Actions 使用的服务器 SSH 私钥 |
| `GHCR_PROXY_SUBSCRIPTION` | 德国代理节点订阅地址 |

`GITHUB_TOKEN` 由 GitHub Actions 自动提供，用于推送和拉取 GHCR 镜像。

禁止把以下内容写进仓库、说明书或日志：

- SSH 私钥正文；
- `.env` 内容；
- 数据库密码；
- GHCR Token；
- 代理订阅完整链接和订阅 Token。

## 12. 正常耗时

最后一次成功部署运行号为 `33258532842`，实际时间为：

| 阶段 | 耗时 |
|---|--:|
| 应用验证 | 约 1 分 25 秒 |
| 构建并推送镜像 | 约 3 分 51 秒 |
| 服务器拉取、切换和健康检查 | 约 3 分 09 秒 |
| 总计 | 约 9 分钟（包含任务排队） |

通常应在 6 到 15 分钟内完成。镜像缓存未命中或 GitHub 排队时可能更久。

## 13. 常见故障

### 一直显示 pending

原因通常是：

- 同一分支已有另一个工作流占用并发锁；
- 正在等待 GitHub `production` Environment 审批；
- GitHub 托管 Runner 正在排队。

先查看运行页面，不要反复点击部署，否则会产生更多排队任务。

### 镜像拉取出现 unexpected EOF 或 PROTOCOL_ERROR

表示服务器到 GHCR 的代理连接中断，不是代码构建失败。

检查：

```bash
sudo systemctl status sing-box-ghcr --no-pager
sudo journalctl -u sing-box-ghcr -n 80 --no-pager
curl --proxy http://127.0.0.1:17890 -I https://ghcr.io/v2/
```

返回 `401` 对未携带认证的 GHCR 连通性检查是正常的，说明网络已经连接到 GHCR。

### No Germany VLESS node found

代理订阅不可用、内容格式发生变化，或订阅中没有预期的 VLESS 节点。需要检查 `GHCR_PROXY_SUBSCRIPTION`，不能把订阅链接直接打印到日志。

### sing-box 配置校验失败

工作流会在覆盖服务器配置和拉取镜像之前停止，不会切换生产容器。检查订阅节点参数和 sing-box 版本兼容性。

### Build production application 失败

说明代码无法完成生产构建。先在本地执行：

```powershell
npm ci --legacy-peer-deps
npm run build
```

修复后重新提交，不能跳过验证强行部署。

## 14. 部署后核对

GitHub Actions 显示全部绿色后，执行以下检查：

1. 打开 `https://mle6.cn`；
2. 登录生产账号；
3. 检查本次修改的页面和功能；
4. 检查视频播放、拖动进度条、分享等相关功能；
5. 确认没有出现 500、登录失败或容器反复重启。

服务器侧可检查：

```bash
cd /opt/vitransfer/vitransfer-test
docker compose ps
docker inspect -f '{{.State.Health.Status}}' vitransfer-app
docker inspect -f '{{.State.Health.Status}}' vitransfer-worker
curl --fail https://mle6.cn/api/health
```

## 15. 本次成功部署参考

```text
提交：7c70a855e153a871ba41fe10d15a0bd10480fe83
运行：33258532842
结果：Verify、Build image、Deploy 三个阶段全部成功
地址：https://github.com/xiaoxiaobai622-boop/xiaobaic-review/actions/runs/33258532842
```

这次成功证明当前流程可以完成：GitHub 云端构建镜像、推送 GHCR、服务器通过德国代理拉取、切换容器和健康检查。

## 16. 分支保护设置

仓库管理员需要为 `main` 分支启用保护规则，确保所有变更都必须经过 Pull Request：

1. 打开 `https://github.com/xiaoxiaobai622-boop/xiaobaic-review/settings/branches`。
2. 点击 **Add classic branch protection rule**。
3. 在 **Branch name pattern** 中填入 `main`。
4. 勾选以下选项：
   - **Restrict pushes that create files larger than 100 MB**
   - **Require a pull request before merging**
     - **Require approvals**：建议至少 `1`
     - **Dismiss stale PR approvals when new commits are pushed**
   - **Require status checks to pass before merging**
     - 搜索并勾选 `Xiaobaic CI and Manual Deploy` 的验证任务
   - **Require conversation resolution before merging**
   - **Do not allow bypass the above settings**
   - **Restrict who can push to matching branches**（可选，限制可推送人员）
   - **Block force pushes**
5. 点击 **Create** 保存。

启用后，任何人都无法直接 `git push origin HEAD:main`，必须通过 PR 合并。
