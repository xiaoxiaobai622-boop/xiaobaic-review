# 搜索引擎验证与提交记录 · 2026-10-07

站点：`https://vidx.cn/`（逐帧审阅 / FrameReview）
记录人：Qoder 会话（在业主登录态下操作）；业主本人负责所有登录、滑块验证、部署触发。
一句话结论：**上线三天"零抓取"的状态在今天结束前被打破——Googlebot、Bingbot、OAI-SearchBot 三家都已在抓；三家站长平台的归属验证全部完成，百度资源通道仍为 0 配额（暂缓）。**

---

## 一、验证凭据（可核对，不含密钥）

| 平台 | 归属验证方式 | 凭据 | 状态 |
|---|---|---|---|
| Bing Webmaster Tools | DNS CNAME | 主机记录 `83eb6af6a02ad7fc86bfa130b6aed224` → `verify.bing.com` | 已验证；sitemap 已提交（Submitted / Processing） |
| 百度站长平台 | 站点根目录文件 | `public/baidu_verify_codeva-X2K1qzPHES.html`（32 字节，内容取自 `ziyuan.baidu.com/site/verifyfile?id=1430934653`） | 已验证（站点 `https://vidx.cn/`，`id=1430934653`）。⚠️ 另有一条 `https://www.vidx.cn/`（`id=1430934100`）未验证，www 已 301，该记录作废 |
| Google Search Console | 页面 HTML meta | `<meta name="google-site-verification" content="jcbUCYdaa4CZ9pyjSOvZ5vQhZRC2tfHjwTarSqENXuo">`，写在 `src/app/layout.tsx` 的 `verification.google`（全站每页都带） | 资源 `https://vidx.cn/` 已验证；网址检查显示「网址已收录到 Google」「网页已编入索引」「HTTPS 正常」；已点「请求编入索引」 |
| IndexNow | key 文件 | `public/bc4f9976576a47b590d7f3c48232d2fe.txt`（32 字节） | 已上线；`POST https://api.indexnow.org/indexnow` 提交 11 条 URL → **HTTP 202 Accepted** |

**故意不写进本文的东西**：百度「普通收录」的主动推送接口地址里含**准入密钥**（在 `ziyuan.baidu.com/linksubmit/index?site=https://vidx.cn/` 页面可见）。按本仓约定凭据只走运行环境、不落文件，所以此处只记位置不记值。

---

## 二、抓取证据（生产 Caddy 访问日志原文）

日志位置：`/var/lib/docker/volumes/vitransfer-test_caddy-data/_data/logs/vidx.access.log`（JSON 行；按天滚动，保留 190 份）。

```
2026-10-06T20:46:14Z  66.249.66.10     /robots.txt                          200  Googlebot
2026-10-06T21:35:36Z  74.7.244.13      /robots.txt                          200  OAI-SearchBot
2026-10-07T00:35:20Z  51.8.102.89      /robots.txt                          200  Bingbot
2026-10-07T01:48:40Z  51.8.102.188     /robots.txt                          200  Bingbot
2026-10-07T03:08:15Z  40.77.167.235    /robots.txt                          200  Bingbot
2026-10-07T03:26:51Z  52.167.144.236   /                                    200  Bingbot
2026-10-07T03:31:54Z  52.167.144.169   /sitemap.xml                         200  Bingbot
2026-10-07T05:20:54Z  40.77.167.15     /bc4f9976576a47b590d7f3c48232d2fe.txt 301   Bingbot
2026-10-07T05:20:56Z  40.77.167.15     /bc4f9976576a47b590d7f3c48232d2fe.txt 200   Bingbot
2026-10-07T09:48:34Z  66.249.66.196    /robots.txt                          200  Googlebot
2026-10-07T10:03:41Z  66.249.66.195    /sitemap.xml                         200  Googlebot
2026-10-07T10:10:22Z  66.249.66.196    /robots.txt                          200  Googlebot
```

当日 UA 家族命中合计（含 `www.vidx.access.log`）：**Bingbot 12 / Googlebot 7 / OAI-Search 3**。

⚠️ 明细里另有两行 `223.91.64.231` 带 Googlebot UA 的记录是**取证时我自己 curl 的**，不是引擎，不计入结论。

对照基线（10-06 23:2x 测得）：09-30 11:46 → 10-06 15:19 UTC 共 20,940 行日志里，11 种引擎/大模型爬虫 UA **命中 0 次**；`/robots.txt` 的 58 次请求 UA 全为空（扫描器）。

---

## 三、今天做掉的动作（按时间）

| 时间(CST) | 动作 | 证据 |
|---|---|---|
| 11:24 | DNSPod 加 Bing 的 CNAME 记录 | `dig …vidx.cn CNAME` 在 `119.29.29.29`/`223.5.5.5`/`8.8.8.8` 三个解析器都返回 `verify.bing.com`；原有 7 条记录未改动，现 8 条 |
| 11:2x | Bing 站点验证通过、提交 sitemap | Bing 后台 `Known sitemaps 1`，状态 Submitted / Processing |
| 11:53 | 生产 Caddy：www 收口 | 备份 `/opt/vitransfer/vitransfer-test/Caddyfile.bak-www301-20261007-115258`(600)；`www.vidx.cn` 块 `reverse_proxy` → `redir https://vidx.cn{uri} permanent`；`www.mle6.cn` 的 301 目标由 `www.vidx.cn` 改为 apex；`caddy validate` 通过后 reload。复验：`https://www.vidx.cn/features/versions` → 301 → apex 同路径；apex 全部仍 200 |
| 12:00 | 提交 `0d58b8d`（百度验证文件 + IndexNow key）并推送 | `git show --stat`；推送范围 `be4b632..0d58b8d` |
| 13:1x | 业主部署该提交 | 两文件线上 200、内容逐字一致（`Last-Modified` 04:42:55 GMT） |
| 13:2x | 百度 apex 站点验证通过 | 它的抓取器 `112.34.110.142`（UA 伪装 Firefox/20）13:18:44 用 HTTP/1.1 取到验证文件 **200 / 32 字节**；站点列表进入「管理站点」 |
| 13:3x | IndexNow 提交 11 条 URL | `POST https://api.indexnow.org/indexnow` → **HTTP 202** |
| 16:13 | Google 验证 meta 随 `4e74b43` 进仓库 | `git log -S'jcbUCYdaa'` 定位到该提交 |
| 16:21 | 提交 `08d5051`（新增断言）并推送 | 断言总数 193 → **194**；推送范围 `0d58b8d..08d5051` |
| 18:0x | GSC 提交 sitemap + 请求编入索引 | 站点地图列表 1 行 `/sitemap.xml`；网址检查「已收录 / 已编入索引 / HTTPS 正常」 |

代码侧另有一整层 AI/GEO 改动已在线上（`/llms.txt` 路由、内容页 `Article` 节点、全站 `Organization`+`WebSite`、首页 canonical 与 Open Graph），细节见 `docs/superpowers/specs/2026-09-20-marketing-content-pages-design.md` §14 第 13–15 条。

---

## 四、已知问题与未决项

1. **GSC 的 sitemap 显示「无法读取此站点地图」**，但同一时刻日志里 Googlebot 抓 `/sitemap.xml` 是 **200**。判为首次读取失败的旧状态，等其自行重读。境外取该文件 0.12 秒 / 1184 字节 / XML 完整，`Googlebot/2.1` UA 从境外取首页 200。
2. **百度资源通道四条全堵**：API 推送 `{"error":400,"message":"over quota"}`；sitemap「今日提交上限 0 条」；快速抓取「暂无权限」；抓取诊断点了被滑块挡（日志中无百度蜘蛛请求，不算网站故障）。提额入口是「主体备案号」与「关联主体」，但备案号两种写法（`桂ICP备2026022852号`、`…-1`）`/icp/set` 都回「暂未查到您网站的备案信息」——而腾讯云备案后台实测该域名**确实在备案里**（网站号 `桂ICP备2026022852号-1`，主体 南宁轻创社科技有限公司，云资源 `111.229.35.33(sh)`，状态正常）。⇒ 判为百度备案库未同步 2026 年新号。业主已决定**百度暂缓**。
3. **备案号悬挂口径**（合规，与 SEO 无关）：页脚与营销页挂的是**主体号** `桂ICP备2026022852号`，腾讯云要求悬挂**网站号** `…-1`；`src/components/LegalDoc.tsx:52` 另有 `…2026017259号-2`。改哪一枚需业主指定，未动。
4. **站点领域 30 天锁定**：保存值为「影视动漫 + 工具服务及在线查询 + 其它」，其中「其它」是百度默认帮勾、提交前取消未生效所致；验证成功后 30 天内只能改一次。
5. **百度列表残留**一条未验证的 `https://www.vidx.cn/` 记录，未删。

---

## 五、明天怎么复查（可直接复制）

```bash
# ① 引擎有没有从"只抓 robots/sitemap"进到"抓内容页"
ssh -i ~/.ssh/vitransfer_codex root@111.229.35.33 'cd /var/lib/docker/volumes/vitransfer-test_caddy-data/_data/logs && jq -r "select((.request.headers[\"User-Agent\"]//[\"-\"])[0]|test(\"googlebot|bingbot|baiduspider|gptbot|oai-search|chatgpt|perplexity|claudebot\";\"i\")) | [(.ts|floor|todate),.request.client_ip,.request.uri,(.status|tostring)]|@tsv" vidx.access.log | grep -E "features|compare|llms" | tail -20'

# ② 各引擎命中计数
ssh -i ~/.ssh/vitransfer_codex root@111.229.35.33 'cd /var/lib/docker/volumes/vitransfer-test_caddy-data/_data/logs && jq -r ".request.headers[\"User-Agent\"][0] // \"-\"" vidx.access.log | grep -oiE "googlebot|bingbot|baiduspider|gptbot|oai-search|chatgpt|perplexity|claudebot" | sort | uniq -c'

# ③ 归属凭据是否仍在线（三个都应 200）
for p in /robots.txt /sitemap.xml /llms.txt /baidu_verify_codeva-X2K1qzPHES.html /bc4f9976576a47b590d7f3c48232d2fe.txt; do printf '%-42s ' "$p"; curl -s -o /dev/null -m 25 -w '%{http_code}\n' "https://vidx.cn$p"; done

# ④ 本机全量断言（改过代码后跑两遍，第一遍可能是 dev 重编译窗口）
cd ~/code/xiaobaic-review && node scripts/seo-check.mjs

# ⑤ 部署后线上验收（业主执行）
SEO_CHECK_BASE=https://vidx.cn node scripts/seo-check.mjs
```

GSC 侧看两处：**编制索引 → 网页**（索引量是否出数，页面提示约 1 天）与**站点地图**（`/sitemap.xml` 是否转为成功读取）。
