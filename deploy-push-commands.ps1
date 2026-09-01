# 飞书推送功能部署命令
# 在本地 Windows PowerShell 中执行

# 1. 进入项目目录
cd "C:\Users\EDY\Documents\ChatGPT\网站\vitransfer-deploy-local"

# 2. 确认当前分支
git branch --show-current
# 应该显示: codex/feishu-push-button-placement

# 3. 查看提交状态
git log --oneline -1
# 应该看到: feat: 优化飞书推送按钮位置和权限控制

# 4. 推送到 GitHub
git push -u origin codex/feishu-push-button-placement

# 5. 推送成功后，访问以下链接创建 PR:
# https://github.com/xiaoxiaobai622-boop/xiaobaic-review/compare/codex/feishu-push-button-placement

Write-Host "推送完成！接下来:"
Write-Host "1. 访问 GitHub 创建 Pull Request"
Write-Host "2. 等待 CI 检查通过"
Write-Host "3. 合并到 main 分支"
Write-Host "4. 触发部署到生产环境"
