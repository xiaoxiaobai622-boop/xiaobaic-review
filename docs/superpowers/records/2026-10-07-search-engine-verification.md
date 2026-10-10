# 搜索引擎验证与提交记录 · 2026-10-07

站点：`https://vidx.cn/`（逐帧审阅 / FrameReview）
记录人：Qoder 会话（在业主登录态下操作）；业主本人负责所有登录、滑块验证、部署触发。
一句话结论（**10-09 更正**）：**引擎其实从 09-30 起就一直在抓**——Googlebot 每天都有（09-30 五十次、10-01 七十三次、10-07 七十六次、10-09 二十三次），GPTBot / OAI-SearchBot 几乎天天来，Bingbot 从 10-01 起，Baiduspider 10-08 也出现过一次。本文上一版写的"上线三天零抓取"是**取证探针用错字段造成的假结论**，详见 §二。当天真正完成的是三家站长平台的归属验证；仍未解决的是**内容页被抓到的次数极少**（全窗口只有 `/features/versions` 6 次、`/compare/fenzhen` 2 次、`/compare/netdisk-wechat` 2 次）以及索引量还没出数。

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

### 按天 × 引擎的真实命中（10-09 重测，含已压缩的历史日志）

| 日期 | Googlebot | Bingbot | GPTBot | OAI-Search | Baiduspider | Perplexity |
|---|---|---|---|---|---|---|
| 09-30 | 50 | – | 26 | 4 | – | – |
| 10-01 | 73 | 22 | – | 1 | – | – |
| 10-02 | 1 | 4 | 51 | 5 | – | – |
| 10-03 | 18 | – | 7 | 3 | – | – |
| 10-04 | 3 | – | 1 | 5 | – | – |
| 10-05 | 1 | 2 | 19 | 4 | – | – |
| 10-06 | 2 | – | 1 | 4 | – | 1 |
| 10-07 | 76 | 6 | 2 | 6 | – | – |
| 10-08 | 8 | 15 | 1 | 2 | 1 | – |
| 10-09（至 15:41 CST） | 23 | – | – | 2 | – | – |

引擎抓过的 URL 按类别拆开看（**10-09 第二次更正**：上一版只数了当前日志文件、没算 `.gz`，把内容页抓取的量低估了）：

| 日期 | 引擎 | 抓到内容页/AI 层的次数 |
|---|---|---|
| 10-05 | GPTBot | **8** |
| 10-06 | Googlebot / GPTBot / ClaudeBot / Perplexity / OAI-Search / 其他 | 各 1（合计 6） |
| 10-07 | Googlebot | 2 |
| 10-08 | 其他 | 3 |
| **10-09** | **Baiduspider** | **10**（百度验证后第二天就开始抓内容页） |

同期 Googlebot 10-09 共 23 次，其中 16 次是 `_next` 静态资源 ⇒ 它在渲染页面；`/robots.txt` 累计 87 次、`/` 34 次、`/sitemap.xml` 6 次。⇒ **AI 抓取器（GPTBot/ClaudeBot/Perplexity/OAI-Search）从 10-05 起就在读内容页，百度今天加入**；仍没被碰过的是两个枢纽页 `/features`、`/compare` 与 `/llms.txt`。

### ⚠️ 10-09 线上全量验收查出的两个问题（10-09 晚已复测，状态见下）

`SEO_CHECK_BASE=https://vidx.cn node scripts/seo-check.mjs` → **193 通过 / 1 失败**：

```
FAIL 首页 og:image 是绝对址且与 canonical 同源（不是 localhost 兜底）
线上实测：<meta property="og:image" content="http://localhost:4321/og/brand-1200x630.png">
内容页对照：<meta property="og:image" content="https://vidx.cn/og/brand-1200x630.png">   ← 正确
```

根因：根 layout 没有 `metadataBase`（那里取基址一抛就是全站 500），而首页 `openGraph.images` 给的是相对路径，于是 Next 用默认基座 `http://localhost:<内部端口>` 拼。**影响面**：首页在微信/飞书/Google/AI 引擎里的分享卡片没有图。
**修复状态（10-09 晚复测）**：① 首页 `og:image` 的 `metadataBase` 修复已随 `5c221ec` 提交并部署，**线上实测已是 `https://vidx.cn/og/brand-1200x630.png`** ✅。② 但那次改动带来第二个问题：首页 canonical 与 og:url 被 Next 归一成**不带尾斜杠**的 `https://vidx.cn`，而 `sitemap.xml` 里首页那条是 `<loc>https://vidx.cn/</loc>` —— 同一个页面两个地址。已把 `src/app/sitemap.ts` 的首页那条改成不带斜杠（跟 canonical 对齐；归一是 Next 做的，反过来对不齐），断言同步改为按不带斜杠判，并新增 `sitemap 首页那条与 canonical 同形`。本机 `node scripts/seo-check.mjs` → **195 条全绿**。**10-09 晚已部署（`d31fe95` 的 workflow_dispatch 14:47 success），线上复跑 `SEO_CHECK_BASE=https://vidx.cn` → 195 条全绿、0 失败**：sitemap 首页那条现在是 `<loc>https://vidx.cn</loc>`，与首页 canonical `https://vidx.cn` 同形。

### ⚠️ 一个把结论整个带偏的探针错误

10-06 那次测得"20,940 行里 11 种爬虫 **0 命中**"，据此写了"零抓取"。今天复查发现**根因是取 UA 的字段用错**：这台机器的 Caddy 访问日志里 `user_agent` 对象是 `null`，UA 只在 `.request.headers["User-Agent"][0]`。同一份日志、同一时间窗实测对照：

```
jq -r '.user_agent.original // "-"'          | grep -icE 'googlebot|bingbot'  →  0
jq -r '(.request.headers["User-Agent"])[0]'  | grep -icE 'googlebot|bingbot'  → 21
```

⇒ 凡是"日志里有没有某类 UA"的结论，必须用 `request.headers["User-Agent"]`，用 `user_agent.original` 会稳定假绿。复查命令已按这个改。

⚠️ 明细里另有几行 `223.91.64.231` 带 Googlebot UA 的记录是**取证时我自己 curl 的**，不是引擎，不计入结论。

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
6. **真正的瓶颈是"抓取深度"，不是"有没有人来"**：引擎天天来，但 87 次里绝大多数是 `/robots.txt`，内容页只有 3 个 URL 被碰过（`/features/versions` 6、`/compare/fenzhen` 2、`/compare/netdisk-wechat` 2），两个枢纽页和 `/llms.txt` 至今 0 次。**排除了一个常见猜测**：不是内链问题——线上首页 SSR HTML 里 8 条链接全都在（`/features`、`/compare` 各 1–3 次，六篇各 1–2 次，实测 `grep 'href="/\(features\|compare\)'`），`/features` 也正常链向它那 3 篇。⇒ 剩下的可解释点主要是 **GSC 那条「无法读取此站点地图」还没恢复**（Google 拿不到 URL 清单，只能靠首页一层链接碰运气），以及新站权重本身。下一步该做的是用 GSC「网址检查」逐个查内容页收录状态，而不是再推 IndexNow。

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
