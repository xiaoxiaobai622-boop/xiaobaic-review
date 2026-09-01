#!/bin/bash
# 快速推送到 GitHub

cd ~/code/xiaobaic-review

echo "=========================================="
echo "推送飞书推送功能到 GitHub"
echo "=========================================="
echo ""

echo "当前分支:"
git branch --show-current
echo ""

echo "最新提交:"
git log --oneline -1
echo ""

echo "开始推送..."
git push -u origin codex/feishu-push-button-placement

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✅ 推送成功！"
    echo "=========================================="
    echo ""
    echo "接下来请访问 GitHub 创建 Pull Request:"
    echo "https://github.com/xiaoxiaobai622-boop/xiaobaic-review/compare/codex/feishu-push-button-placement"
else
    echo ""
    echo "❌ 推送失败，请检查网络连接和 GitHub 权限"
fi
