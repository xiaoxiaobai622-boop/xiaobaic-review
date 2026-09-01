# Claude Git 推送工作流说明书

> **重要提醒**：xiaoxiaobai 的 Mac 已经配置好 GitHub 集成，可以直接使用 GitHub MCP 工具推送，**不需要**用户在终端手动执行命令！

---

## ❌ 常见错误做法

### 错误 1：要求用户在终端手动推送
```bash
# ❌ 不要这样做
cd ~/code/xiaobaic-review
git push -u origin some-branch
```

**问题**：用户之前从来不需要手动在终端操作，因为 Claude 有 GitHub MCP 集成。

### 错误 2：尝试在 Linux 环境中使用 SSH
```bash
# ❌ 不要这样做
git push -u origin codex/some-branch
# 结果：kex_exchange_identification: Connection closed by remote host
```

**问题**：Claude 的 Linux 隔离环境无法访问用户的 SSH 密钥。

---

## ✅ 正确的推送流程

### 第一步：在本地 Git 仓库创建分支并提交

```bash
cd /sessions/sleepy-hopeful-shannon/mnt/xiaobaic-review

# 1. 检查当前分支
git branch --show-current

# 2. 如果在 main 分支，创建新的开发分支
git checkout -b codex/feature-name

# 3. 配置 git 用户信息（如果需要）
git config user.name "xiaoxiaobai622-boop"
git config user.email "xiaoxiaobai622@gmail.com"

# 4. 只添加需要提交的文件（不要 git add .）
git add src/path/to/file1.tsx src/path/to/file2.tsx

# 5. 提交
git commit -m "feat: 功能描述

- 详细说明1
- 详细说明2
- 详细说明3"
```

### 第二步：使用 GitHub MCP 工具推送

**关键**：不要尝试用 `git push`，而是使用 `mcp__github__push_files` 工具！

```typescript
// 1. 读取需要推送的文件内容
const file1Content = await Read('src/path/to/file1.tsx')
const file2Content = await Read('src/path/to/file2.tsx')

// 2. 使用 GitHub MCP 工具推送
await mcp__github__push_files({
  owner: "xiaoxiaobai622-boop",
  repo: "xiaobaic-review",
  branch: "codex/feature-name",
  message: "feat: 功能描述\n\n- 详细说明1\n- 详细说明2",
  files: [
    {
      path: "src/path/to/file1.tsx",
      content: file1Content
    },
    {
      path: "src/path/to/file2.tsx",
      content: file2Content
    }
  ]
})
```

### 第三步：创建 Pull Request

```typescript
await mcp__github__create_pull_request({
  owner: "xiaoxiaobai622-boop",
  repo: "xiaobaic-review",
  title: "feat: 功能描述",
  head: "codex/feature-name",
  base: "main",
  body: `## 📝 变更说明

### 功能优化
- 详细说明1
- 详细说明2

### 修改文件
- \`src/path/to/file1.tsx\` - 说明
- \`src/path/to/file2.tsx\` - 说明

### 测试
- ✅ 测试项1
- ✅ 测试项2

## 🚀 部署说明

合并后需手动触发 GitHub Actions 部署工作流`
})
```

---

## 📋 完整示例

```typescript
// 场景：提交飞书推送功能的改动

// 1. 创建分支并提交
await Bash(`
cd /sessions/sleepy-hopeful-shannon/mnt/xiaobaic-review
git checkout -b codex/feishu-push-button
git config user.name "xiaoxiaobai622-boop"
git config user.email "xiaoxiaobai622@gmail.com"
git add src/components/ProjectActions.tsx src/components/FeishuPushButton.tsx
git commit -m "feat: 优化飞书推送按钮"
`)

// 2. 读取文件内容
const projectActionsContent = await Read('/Users/xiaoxiaobai/code/xiaobaic-review/src/components/ProjectActions.tsx')
const feishuButtonContent = await Read('/Users/xiaoxiaobai/code/xiaobaic-review/src/components/FeishuPushButton.tsx')

// 3. 推送到 GitHub
await mcp__github__push_files({
  owner: "xiaoxiaobai622-boop",
  repo: "xiaobaic-review",
  branch: "codex/feishu-push-button",
  message: "feat: 优化飞书推送按钮位置和权限控制",
  files: [
    { path: "src/components/ProjectActions.tsx", content: projectActionsContent },
    { path: "src/components/FeishuPushButton.tsx", content: feishuButtonContent }
  ]
})

// 4. 创建 PR
const pr = await mcp__github__create_pull_request({
  owner: "xiaoxiaobai622-boop",
  repo: "xiaobaic-review",
  title: "feat: 优化飞书推送按钮位置和权限控制",
  head: "codex/feishu-push-button",
  base: "main",
  body: "详细的 PR 描述..."
})

console.log(`✅ PR 创建成功: ${pr.url}`)
```

---

## 🔑 关键要点

1. **永远不要要求用户手动推送** - 用户的 Mac 有 GitHub MCP 集成
2. **本地 git 操作用 Bash** - 创建分支、提交等
3. **推送用 GitHub MCP 工具** - `mcp__github__push_files`
4. **创建 PR 用 GitHub MCP 工具** - `mcp__github__create_pull_request`
5. **只提交相关文件** - 不要 `git add .`，明确指定文件

---

## 📂 项目信息

- **仓库**：`xiaoxiaobai622-boop/xiaobaic-review`
- **主分支**：`main`（有分支保护，必须通过 PR 合并）
- **开发分支命名**：`codex/功能名称`
- **Git 用户**：
  - Name: `xiaoxiaobai622-boop`
  - Email: `xiaoxiaobai622@gmail.com`

---

## 🚀 部署流程

1. ✅ 创建开发分支并提交
2. ✅ 使用 GitHub MCP 工具推送
3. ✅ 创建 Pull Request
4. ⏳ 等待 CI 检查通过
5. ✅ 合并到 main 分支
6. ✅ 手动触发 GitHub Actions 部署工作流
7. ⏳ 等待约 9 分钟部署完成
8. ✅ 访问 https://mle6.cn 验证

---

## ⚠️ 注意事项

- **分支保护**：`main` 分支禁止直接推送
- **CI 检查**：必须通过 `Verify application` 检查
- **提交信息**：使用约定式提交格式（feat:, fix:, docs: 等）
- **文件选择**：只提交与当前功能相关的文件
- **环境差异**：Claude 在 Linux 环境中操作，路径映射：
  - Mac: `/Users/xiaoxiaobai/code/xiaobaic-review`
  - Linux: `/sessions/sleepy-hopeful-shannon/mnt/xiaobaic-review`
