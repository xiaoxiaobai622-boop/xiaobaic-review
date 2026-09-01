@echo off
chcp 65001 >nul
echo ========================================
echo 推送飞书推送功能到 GitHub
echo ========================================
echo.

cd /d "C:\Users\EDY\Documents\ChatGPT\网站\vitransfer-deploy-local"

echo 当前分支:
git branch --show-current
echo.

echo 最新提交:
git log --oneline -1
echo.

echo 开始推送...
git push -u origin codex/feishu-push-button-placement

echo.
echo ========================================
echo 推送完成！
echo ========================================
echo.
echo 接下来请:
echo 1. 访问 GitHub 创建 Pull Request
echo 2. 等待 CI 检查通过
echo 3. 合并到 main 分支
echo 4. 在 GitHub Actions 手动触发部署
echo.
pause
