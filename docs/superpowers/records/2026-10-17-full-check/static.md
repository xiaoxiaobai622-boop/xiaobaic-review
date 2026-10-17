# 静态门禁与类型/规范检查 全量体检报告（audit-1017）

- 仓库：`/Users/xiaoxiaobai/code/xiaobaic-review`（任务里写的 `/Users/xiaobaic/...` 是笔误，该路径不存在）
- 提交态：`HEAD = 327d6c7ab1fd8fc3dc7a98019aecb57c18a609f2`（"Default the mail from-address to vidx.cn…"，2026-10-17）
- 采集时间：2026-10-17
- 结论一句话：**唯一真红的门禁是 `npm run lint`（1 error / 10 warnings），而且它在提交态就红，且这条门禁没进 CI，所以它红不红拦不住任何一次上线。** 其余门禁全绿，但 29 支判据脚本里 20 支没有任何东西会去跑它们。
- 全程只读：没有修改任何文件，没有 `git add/commit/checkout/reset/stash/clean`，没有碰 `.next`，没有跑 `npm run build`，没有 `npm install`，没有重启业主的 `next dev`（PID 4498 全程存活，跑完 `git status --short` 仍是只有 `?? .superpowers/ ?? design/`）。
- 为守只读：所有 `tsc` 一律带 `--incremental false`（tsconfig 里 `incremental: true`，否则会把仓库根的 `tsconfig.tsbuildinfo` 覆写掉）。类型判定结果与不带该开关完全等价。

---

## ① 脚本清单与"是否进 CI"

### `package.json` 的全部 scripts（7 条，没有第 8 条）

| 脚本 | 内容 | 性质 | 进 CI？ |
|---|---|---|---|
| `dev` | `next dev --webpack` | 非门禁 | — |
| `build` | `next build --webpack` | 构建（Next 16.3.8 在 build 内跑 tsc；`typescript.ignoreBuildErrors` 未设） | ✅ `verify` 第 4 步 |
| `start` | `next start` | 非门禁 | — |
| `lint` | `eslint .` | **规范门禁** | ❌ **完全没进 CI** |
| `check:static` | 9 支 `tsx scripts/check-*.mts` 用 `&&` 串起来 | **静态判据门禁** | ✅ `verify` 第 3 步 |
| `postinstall` | `prisma generate` | 安装钩子 | ✅ 随 `npm ci` |
| `worker` | `tsx src/worker/index.ts` | 运行时 | — |

**不存在**的脚本：`typecheck`、`test`、`check:full`、`audit`、`format`、`lint:fix`。
`tsc --noEmit` 不是 package 脚本，只是 `DEPLOYMENT.md` §4「本地验证」里让人手敲的命令行；`npm audit --omit=dev --audit-level=high` 反过来只在 CI 里有、本地没有脚本。

### CI 定义（`.github/workflows/`，共 9 个文件）

真正会跑的只有一个：

- **`xiaobaic-ci-deploy.yml`** — `on: push: branches [main] / pull_request: branches [main] / workflow_dispatch`
  `verify`（"Verify application"）作业的四步门禁，逐字：
  1. `npm ci --legacy-peer-deps`
  2. `npm audit --omit=dev --audit-level=high`
  3. `npm run check:static`（注释见文件 48–50 行：只跑零凭据/零网络/零数据库的静态判据，会读写库那批判据刻意不进 CI）
  4. `npm run build`（env: `SKIP_ENV_VALIDATION=1`、`NEXT_PHASE=phase-production-build`）
  `image` / `deploy` 两个作业 `needs: verify` 且要求 `workflow_dispatch` + `inputs.confirm_production` ⇒ 上线确实被 `verify` 卡着。

跑不起来的（详见 S14）：

- `docker-integration-tests.yml`：`on: push/pull_request: branches [dev]` — **仓库里没有 `dev` 分支**（`git branch -a` 只有 `main`、`undici-lock-bump`、若干 `codex/*`）。
- `test-clean-install.yml`、`test-upgrade.yml`：`on: release: types [published]` — **仓库 0 个 tag**（`git tag --list` 空）。
- `test-dev-clean-install.yml`、`test-dev-upgrade.yml`：`workflow_call` + `workflow_dispatch`，只被上面那个 dev 分支的入口引用。
- `backup-production.yml`、`update-mps-template.yml`：`workflow_dispatch` 手动，非门禁。

⇒ 一条打到 `main` 的 PR，实际只有 `verify` 这一道闸；`lint` 不在其中。

---

## ② 失败项原样贴（命令 + 失败行）

### S1 —— `npm run lint` 红（提交态 + 工作树**都红**）｜严重度：阻断｜谁能修：代码侧

```
命令：npm run lint            （= eslint . ，eslint 9.39.4 / eslint-config-next 16.2.12）
提交态副本 /tmp/audit-1017/clean ：exit=1
当前工作树                     ：exit=1   ← 两边逐行一致（diff 空）
```

失败原文（工作树路径，提交态同内容仅前缀为 `/private/tmp/audit-1017/clean`）：

```
/Users/xiaoxiaobai/code/xiaobaic-review/src/components/ReviewLoginActions.tsx
  420:21  error  Do not use an `<a>` element to navigate to `/forgot-password/`. Use `<Link />` from `next/link` instead. See: https://nextjs.org/docs/messages/no-html-link-for-pages  @next/next/no-html-link-for-pages

/Users/xiaoxiaobai/code/xiaobaic-review/src/app/lab/projects/Folders.tsx
  126:9   warning  Using `<img>` could result in slower LCP and higher bandwidth. … @next/next/no-img-element
  227:23  warning  Using `<img>` … @next/next/no-img-element
/Users/xiaoxiaobai/code/xiaobaic-review/src/app/lab/projects/ScreeningRoom.tsx
  35:13   warning  Using `<img>` … @next/next/no-img-element
  57:11   warning  Using `<img>` … @next/next/no-img-element
  74:17   warning  Using `<img>` … @next/next/no-img-element
/Users/xiaoxiaobai/code/xiaobaic-review/src/app/lab/projects/Timeline.tsx
  254:11  warning  Using `<img>` … @next/next/no-img-element
/Users/xiaoxiaobai/code/xiaobaic-review/src/app/wechat-mini-login/page.tsx
  120:46  warning  Using `<img>` … @next/next/no-img-element
/Users/xiaoxiaobai/code/xiaobaic-review/src/components/InitialsAvatar.tsx
  277:9   warning  Using `<img>` … @next/next/no-img-element
/Users/xiaoxiaobai/code/xiaobaic-review/src/components/WechatMiniQrLogin.tsx
  198:11  warning  Using `<img>` … @next/next/no-img-element
/Users/xiaoxiaobai/code/xiaobaic-review/src/components/ThumbnailReel.tsx
  125:9   warning  The 'currentVideos' conditional could make the dependencies of useEffect Hook (at line 130) change on every render. To fix this, wrap the initialization of 'currentVideos' in its own useMemo() Hook  react-hooks/exhaustive-deps

✖ 11 problems (1 error, 10 warnings)
```

补充事实（不是我的推测，是查到的）：
- 出错那一行是审片登录弹窗里的「忘记密码」：`<a href="/forgot-password" …>`。`src/app/forgot-password/` 路由真实存在，同仓另外两处（`src/app/login/page.tsx:403`、`src/app/reset-password/page.tsx:119`）走的是 `<Link href="/forgot-password">` —— 只有这一处是裸 `<a>`，整页刷新会把弹窗状态打掉。
- `eslint.config.mjs` 里手工关了三条规则：`react-hooks/set-state-in-effect`、`react-hooks/immutability`、`react-hooks/preserve-manual-memoization`。当前这 11 条里没有被这三条掩盖的 error（被掩盖的是不是还有，静态看不出来，只能把开关拿掉重跑才知道）。

### S2 —— 其余全部命令：0 失败（贴总数与退出码，作为"没有别的红"的证据）｜严重度：次要（本条只记录"绿"）

| 命令 | 提交态 | 工作树 | 输出 |
|---|---|---|---|
| `npx tsc --noEmit --pretty false --incremental false` | exit 0，0 行 | exit 0，0 行 | 无任何诊断 |
| `npm run check:static` | exit 0 | exit 0 | 262 条 PASS / 0 条 FAIL（明细见下） |
| `npx tsx scripts/check-drift-guards.mts` | exit 0 | — | 合计 40 PASS / 0 FAIL |
| `npx tsx scripts/check-branding-read-paths.mts` | exit 0 | — | 合计 20 PASS / 0 FAIL |
| `npx tsx scripts/check-dual-video-sync.mts` | exit 0 | — | `OK  36 条断言全部通过` |
| `npx tsx scripts/check-team-writeable.mts` | exit 0 | — | `7 passed, 0 failed` |
| `npx tsx scripts/check-home-media-budget.mts` | exit 0 | — | 合计 7 PASS / 0 FAIL |
| `npx tsx scripts/check-playback-drift.mts` | exit 0 | — | 合计 13 PASS / 0 FAIL |
| `npx tsx scripts/check-review-login-surface.mts` | exit 0 | — | 合计 53 PASS / 0 FAIL |
| `npx tsx scripts/check-team-numeric-id.mts --static` | exit 0 | — | 合计 32 PASS / 0 FAIL |
| `npx tsx scripts/check-platform-team-identity.mts` | exit 0 | — | 合计 54 PASS / 0 FAIL |
| `npm audit --omit=dev --audit-level=high` | exit 0 | — | `found 0 vulnerabilities` |
| `git diff --check`（DEPLOYMENT.md §4 列的第 2 条本地门禁） | — | exit 0 | 空输出（工作树无已跟踪改动） |
| `SEO_CHECK_BASE=http://127.0.0.1:3000 node scripts/seo-check.mjs` ×2 | — | exit 0 | 见 S9 |

---

## ③ 提交态 vs 工作树 的差异归因

**两边完全一致，没有"只在某个会话工作树里红"的失败项。**

依据（都是实测，不是假设）：
- `git status --short` 从头到尾只有两行：`?? .superpowers/` 和 `?? design/`。**已跟踪文件零改动**，别的会话这次没往提交态里掺东西。
- `npm run lint`：把两边输出里的路径前缀归一后 `diff` 为**空**。
- `npx tsc --noEmit`：两边都 0 行 0 退出码。
- `npm run check:static`：两边输出都是 275 行、同样的 7 段"合计 …/0 FAIL"。

一个方法论上的坑，必须记下来（它决定了"为什么工作树没多红"）：
- `eslint .`（flat config）**会**走进别的会话留下的 `.superpowers/`：工作树扫 **701** 个文件，其中 **65** 个在 `/​.superpowers/` 下面；提交态副本只有 **636** 个。这 65 个文件恰好零违规，所以两边输出才一样。⇒ 见 S16。
- `npx tsc` **不会**走进去：`tsc --listFilesOnly` 在真实工作树里匹配 `superpowers` 的结果是 **0** 个文件（TS 的 glob 默认跳过点开头录；`tsconfig.json` 的 `include` 只显式点了 `.next/types`、`.next/dev/types`）。工作树共 942 个文件入编译。

副本准备（为了可比，都只写 `/tmp`，未回写仓库）：
- `git archive HEAD | tar -x -C /tmp/audit-1017/clean`（未加 `--strip-components`），`node_modules` 用软链指回仓库。
- `next-env.d.ts`、`.next/types/`、`.next/dev/types/`、`.next/package.json` 都是 **gitignore 的生成物**（`.gitignore:67 next-env.d.ts`、`:10 .next/`），`git archive` 里没有。若原样不管，提交态副本会因为缺 `next-env.d.ts`（`*.module.css` 声明、`next` 全局引用）和缺路由校验类型而**假红**。做法：从工作树 `cp` 进副本（对原仓库只读），使两边看到同一份生成物。

---

## ④ 孤儿判据清单（没有任何 check 脚本 / CI / hook 会去跑它们）

方法：对 `scripts/check-*.mts` 与 `scripts/seo-check.mjs` 逐个反查全仓引用（排除 `.git`/`node_modules`/`.next`/`.superpowers`/`design`，并**人工区分"注释里提到"与"真的被执行"**）。唯一算"被接线"的出处是 `package.json` 的 `check:static` 和 workflow 里的 `run:` 行；`tsconfig.tsbuildinfo` 里出现文件名是编译缓存不是引用；`docs/superpowers/**` 里出现是历史台账不是门禁。

- `scripts/check-*.mts` 共 **29** 支。进了 `check:static` 的 **9** 支（其中 1 支只进 `--static` 子集）。
- **孤儿 20 支 + `seo-check.mjs` = 21 个判据无人跑。**
- `check-home-redesign.mts` 被 `check-home-media-budget.mts` 提到，但那一处是 **72 行的注释**（"分辨率下限…住在 check-home-redesign.mts 的 H36·c/H38·b"），不执行 ⇒ 仍算孤儿。同理 `check-player-spinner.mts`(13 行注释)、`check-project-settings-pruned.mts`(327 行注释)、`check-project-settings-panel.mts`(246/762 行注释) 都是注释级提及。`check-project-members.mts:870` 对 `check-project-info-switcher.mts` 是 `readFileSync(...,'utf8')` —— **读它的源码做正则**，不是跑它。

| # | 脚本 | 行数 | 依赖 | 是否写库 |
|---|---|---|---|---|
| 1 | `scripts/check-home-redesign.mts` | 787 | dev server + 真 Chrome（`CHROME_PATH`） | 否（自述"只用浏览器与读文件，不写库、不重启他的 dev"） |
| 2 | `scripts/check-project-members.mts` | 938 | dev + Chrome + `src/lib/db` | 是（fixture 建/删） |
| 3 | `scripts/check-project-settings-panel.mts` | 847 | dev + Chrome + db | 是 |
| 4 | `scripts/check-share-shortlink.mts` | 624 | dev | 是 |
| 5 | `scripts/check-player-spinner.mts` | 563 | dev + Chrome + db | 是 |
| 6 | `scripts/check-rail-avatar-and-collect-copy.mts` | 559 | dev + Chrome + db | 是 |
| 7 | `scripts/check-project-info-switcher.mts` | 543 | dev + Chrome | 是 |
| 8 | `scripts/check-project-settings-pruned.mts` | 542 | dev + Chrome + db | 是 |
| 9 | `scripts/check-share-visitor-ui.mts` | 456 | dev + Chrome | 是 |
| 10 | `scripts/check-team-video-settings.mts` | 335 | dev + Chrome | 是 |
| 11 | `scripts/check-resilience.mts` | 321 | dev | 是 |
| 12 | `scripts/check-recycle-bin-clear.mts` | 257 | dev + db（自述 finally 清场） | 是 |
| 13 | `scripts/check-platform-usage.mts` | 245 | dev + db | 是 |
| 14 | `scripts/check-batch-overwrite.mts` | 264 | dev + `src/lib/db`（自述"finally 删行、删一次性文件"） | 是 |
| 15 | `scripts/check-project-member-count.mts` | 225 | dev + db | 是 |
| 16 | `scripts/check-billing-out-of-build.mts` | 216 | dev + 读 `.env`（自述"全程只 GET，不打任何写方法"） | 否 |
| 17 | `scripts/check-team-gate.mts` | 157 | dev + db | 是 |
| 18 | `scripts/check-phone-field.mts` | 156 | `src/lib/db`（无 dev） | 是（CI 里 D23 专门钉"这条不许进 CI，它会建/删审计行"） |
| 19 | `scripts/check-quota-read-no-write.mts` | 111 | dev | 是 |
| 20 | `scripts/check-team-create-beta.mts` | 88 | dev + db | 是 |
| 21 | `scripts/seo-check.mjs` | 192 行脚本 / 207 条断言 | 活的 BASE（默认 `http://127.0.0.1:3000`） | 否 |

⇒ 结论：这 20 支判据**不是写库就是起浏览器**，所以"进不了 CI"是有意的（`xiaobaic-ci-deploy.yml:48-50` 与 `check-drift-guards.mts` D23 都写了理由）。但**没有任何聚合脚本、hook、CI job 或文档化的"发布前必跑清单"会替业主把它们跑一遍**——只有当初写这条判据的那个会话会手工跑一次。判据本身越写越厚（`check-project-members.mts` 已经 938 行），回归保护却是一次性的。⇒ 见 S6。

---

## ⑤ 编号发现汇总

### S1 —— `npm run lint` 在提交态就有 1 条 error（`ReviewLoginActions.tsx:420` 用裸 `<a>` 跳 `/forgot-password`）｜阻断｜代码侧
唯一真红的门禁，且红在提交态（不是我这次替别人的未提交改动背锅）。同仓另两处同链接都用了 `<Link>`，只有审片登录弹窗这一处是 `<a>`，点了会整页刷新、把弹窗与已填手机号一起丢掉。修法一行。

### S2 —— `lint` 根本没进 CI，而 Next 16 的 `build` 也不再跑 ESLint ⇒ S1 拦不住任何一次上线｜重要｜代码侧（CI 配置）
实测依据：`xiaobaic-ci-deploy.yml` 全文只有 4 个 `run:`，没有 lint；`node_modules/next@16.3.8/dist/server/config-shared.d.ts` 里搜不到 `ignoreDuringBuilds`/`runLint`/`lint` 任何键，`dist/cli/` 下也没有 `next-lint`。也就是说仓库里唯一会红的规范门禁，是一条**没有任何人/机器必须跑**的门禁。`DEPLOYMENT.md` §4 的本地清单（`npx tsc --noEmit` + `git diff --check` + `npm run build`）同样不含 lint。

### S3 —— `check:static` 用 `&&` 串 9 支判据 ⇒ 第一支红就后面 8 支不跑｜次要｜代码侧
CI 只看得到"红在第一支"，拿不到全量失败清单。改成 `bash -c 'set +e; …; exit $total'` 或 `--bail=false` 之类，一次报全部。当前全绿，所以还没咬人。

### S4 —— 门禁自己的门禁（D21）只钉住 9 枚里的 7 枚｜重要｜代码侧
`scripts/check-drift-guards.mts:184-196` 的 `STATIC_CHECKS` 数组只有 7 个文件名（drift-guards / branding-read-paths / dual-video-sync / team-writeable / home-media-budget / playback-drift / review-login-surface），**不含 `check-team-numeric-id.mts` 和 `check-platform-team-identity.mts`**。有人把后两支从 `package.json` 的 `check:static` 里删掉，D21 照样 PASS，CI 照样绿 —— 54 条 + 32 条判据会静默消失。（这两支正是体量最大的两段：`check-platform-team-identity.mts` 单文件 68 KB。）

### S5 —— `check-team-numeric-id.mts` 在 CI 里只跑 `--static` 子集，C 组与全库扫描永不自动跑｜重要｜代码侧（要连库）/ 只有业主能做（要有活的 dev + 真库）
脚本自己的说明（14-15 行）：`--static` 那条进 CI，完整版"再加 C 组与全库扫描；C 组装一次性夹具、要他自己的 next dev 在 :3000 上活着 ⇒ 不进 CI"。输出末行也自陈"（C 组与全库扫描要连库，只在完整跑里做）"。CI 里看到的是 32 PASS，而这条判据真实条数远不止。

### S6 —— 29 支判据里 20 支是孤儿，没有任何聚合器/hook/CI/发布清单会跑它们｜阻断｜代码侧（聚合）+ 只有业主能做（凭据、dev server、Chrome）
明细与依赖归类见 §④。其中 6 支（`check-home-redesign`、`check-billing-out-of-build`、`check-quota-read-no-write`、`check-team-gate`、`check-team-create-beta`、`check-share-shortlink`）自述只 GET 或只读文件，属于"本来就能安全自动化、却没人接"的那一档；`check-home-redesign.mts` 787 行钉的是**对外首页**（含两条"把整站打挂过的真事故"），它一旦没人跑就等于首页改版裸奔。

### S7 —— `scripts/seo-check.mjs`（207 条 SEO/GEO 断言）是孤儿判据｜重要｜代码侧接线 + 只有业主能做（对生产跑）
本地实测两遍（见 S8）全绿，但没有任何 `run:`、package 脚本或文档化清单会执行它；脚本自己的注释（第 5 行）写明它设计成部署后 `SEO_CHECK_BASE=https://vidx.cn node scripts/seo-check.mjs` 再跑一遍 —— **这一步没人做过**（本次体检也未跑，业主只授权打 `127.0.0.1:3000`）。⇒ 生产站的 SEO 态前从未被判据核过。

### S8 —— SEO 判据实测：连跑两遍，207 PASS / 0 FAIL，两遍输出逐字节相同，exit 0｜次要（记录）
```
命令：SEO_CHECK_BASE=http://127.0.0.1:3000 node scripts/seo-check.mjs
第一遍：PASS=207  FAIL=0  exit=0  末行「全部通过」
第二遍：PASS=207  FAIL=0  exit=0  末行「全部通过」
diff 两遍输出：空（不存在 dev 重编译窗口造成的抖动）
```
跑在真实工作树（`/Users/xiaoxiaobai/code/xiaobaic-review`），BASE 用 `http://127.0.0.1:3000`。跑前 `curl -o /dev/null` 探活：`http_status=200 time=0.268s`。无任何 FAIL 原文可贴。

### S9 —— `npm run build`（CI `verify` 第 4 步）本次**未验证**｜重要｜只有业主能做
业主明令禁跑 build / 禁碰 `.next`，而它恰好是 CI 里唯一兜住类型错误的步骤（Next build 会跑 tsc，`typescript.ignoreBuildErrors` 未设）。我能给的旁证只有：`npx tsc --noEmit` 在提交态 0 错、`npm ci` 依赖未动、`npm audit --omit=dev` 0 漏洞。build 期的路由校验/生成（`.next/types` 那一层）无法用 tsc 完全替身。⇒ 上线前需业主自己起一次 build 或看一轮 CI。

### S10 —— `npm audit`（CI 第 2 步）本地实测 0 漏洞、exit 0；但它只在 CI 有、`package.json` 里没有对应脚本｜次要｜代码侧
```
命令：npm audit --omit=dev --audit-level=high --no-fund   （在 /tmp/audit-1017/clean）
输出：found 0 vulnerabilities     exit=0
```
本地跑不了 `npm run audit`，业主按 `DEPLOYMENT.md` 手工体检时踩不到这条。

### S11 —— `tsc` 与 `build` 都看不见 `src/worker`｜次要（今天是干净的，属潜在盲区）｜代码侧
`tsconfig.json:27` `"exclude": ["node_modules", "src/worker/**/*"]`。判据 `check-drift-guards.mts:177-178` 的 D20 明确"承认这是盲区…（注释才是契约）"，只钉了"exclude 里还留着 src/worker"这个形状，没补类型覆盖。我用一份临时副本把 exclude 去掉重跑（`/tmp/audit-1017/worker`，`tsconfig.withworker.json`）：`npx tsc --noEmit --pretty false --incremental false -p tsconfig.withworker.json` → **exit 0、0 行**。⇒ 目前无红，但 worker 层的类型错误会永久静默。

### S12 —— 没有 `typecheck`/`test` 脚本，也没有任何测试框架｜次要｜代码侧
`package.json` 无 `typecheck`/`test`；仓里没有 `jest`/`vitest`/`playwright` 配置或依赖；`docs/superpowers/plans/2026-09-20-marketing-content-pages.md:9` 自述"**无测试框架**——用零依赖 Node 脚本对运行中的 dev server 做 HTTP 断言"。⇒ 判据脚本就是测试，而其中 20 支没人跑（回到 S6）。

### S13 —— Prisma schema/迁移从不做静态校验｜重要｜代码侧（接线）+ 只有业主能做（`migrate status` 要连库）
全仓（`.github/workflows/*.yml`、`package.json`、`*.sh`、`*.md`）搜 `prisma validate` / `prisma format --check` / `migrate status` 命中 0 处；`postinstall` 只有 `prisma generate`。而 `DEPLOYMENT.md` §3 第 5 条把"数据库结构变化必须先单独检查 Prisma migration"写成人工纪律。schema 漂移没有机械闸口。

### S14 —— 4 个 CI workflow 永远不会触发（分支与 tag 前提不成立）｜次要｜代码侧
`docker-integration-tests.yml` 只认 `dev` 分支，仓库没有 `dev`；`test-clean-install.yml` 与 `test-upgrade.yml` 只认 `release: published`，仓库 `git tag --list` 为空；它们调用的 `test-dev-*.yml` 是 `workflow_call`，同样死路。⇒ "装一遍能不能跑起来 / 升级会不会坏"这两类判据实际处于零覆盖状态，而镜像部署作业是直接推到 `main` 就走 `image`+`deploy` 的。

### S15 —— 两个 git hook 是空壳，本地无任何机械拦截｜次要｜代码侧
`.git/hooks/post-commit`、`.git/hooks/post-checkout` 存在且可执行，但内容就是 `#!/bin/sh` 一行（各 10 字节），不执行任何东西。其余 14 个都是 `.sample`。没有 `husky`/`lint-staged`/`prepare`。⇒ 提交侧一道闸都没有（S1 那条 error 就是这么进来的）。

### S16 —— `eslint .` 会把别的会话留在 `.superpowers/` 的草稿一起扫，`tsc` 却不会 ⇒ 这条门禁跨会话不可复现｜次要｜代码侧（改 `eslint.config.mjs` 的 `ignores`）
实测：工作树 `npx eslint . -f json` 扫 **701** 个文件、其中 **65** 个路径含 `/.superpowers/`；`git archive HEAD` 出来的提交态副本只有 **636** 个。今天那 65 个零违规，所以两边输出碰巧逐行一致；但只要别人往 `.superpowers/sdd/**` 扔一个带 `<img>` 的草稿，`npm run lint` 就红了，而这个红跟仓库代码无关。对照：`tsc --listFilesOnly` 在同一个工作树里匹配 `superpowers` 得 **0**（TS glob 默认跳过点目录），所以类型门禁天然不受污染，规范门禁受。

### S17 —— 工作树 vs 提交态：**零差异**，本次没有"别的会话未提交改动造成的红"｜次要（记录）
所有门禁两边逐行一致（`diff` 空 / 同为 exit 0）。归因证据在 §③：已跟踪文件零改动，只有 `?? .superpowers/ ?? design/` 两个未跟踪目录，且 `design/` 里零个 `.ts/.tsx/.js/.mjs` 文件、`.superpowers/` 里的 65 个源文件全部被 tsc 跳过、被 eslint 扫了但零违规（636 + 65 = 701，正好对上 eslint 的文件数）。
注意历史坑：`docs/superpowers/records/2026-10-07-search-engine-verification.md:163` 记过"本机工作树跑 `check:static` 会看到 `check-review-login-surface.mts` 的 P2/P3 两条红，那是另一会话未提交的登录页 i18n 改动" —— **这次没有复现**，两条都绿（53 PASS / 0 FAIL）。

### S18 —— 附带一条环境事实（非门禁失败）：`package.json` 的 `name` 仍是 `vitransfer`、`version` 1.2.6，`npm run *` 横幅会打 `> vitransfer@1.2.6 …`｜次要｜代码侧
所有门禁输出里都带着旧品牌名。`check-drift-guards.mts` 的 D11/D12 钉的是"用户可见文案里不许留旧品牌名"（且 `seo-check` 有"不含 vitransfer"断言，都绿），但它管不到 `package.json` 自己的 `name` 字段 ⇒ 判据覆盖面与 `PRODUCT.md` 的「逐帧审阅 / FrameReview」不同源。

---

## 附：原始输出落盘位置（都在 /tmp，可复核）

```
/tmp/audit-1017/clean/                     提交态副本（git archive HEAD + node_modules 软链 + 复制 next-env.d.ts/.next 生成物）
/tmp/audit-1017/worker/                    提交态副本 + tsconfig.withworker.json（把 src/worker 放回类型覆盖）
/tmp/audit-1017/tsc-clean.txt              提交态 tsc（0 行，exit 0）
/tmp/audit-1017/tsc-worktree.txt           工作树 tsc（0 行，exit 0）
/tmp/audit-1017/tsc-withworker.txt         含 src/worker 的探针（0 行，exit 0）
/tmp/audit-1017/lint-clean.txt             提交态 eslint（exit 1，11 problems）
/tmp/audit-1017/lint-worktree.txt          工作树 eslint（exit 1，11 problems）
/tmp/audit-1017/checkstatic-clean.txt      提交态 check:static（exit 0，275 行）
/tmp/audit-1017/checkstatic-worktree.txt   工作树 check:static（exit 0，275 行）
/tmp/audit-1017/sep-clean-*.txt            9 支判据逐条单跑（提交态）
/tmp/audit-1017/audit.txt                  npm audit --omit=dev（0 漏洞）
/tmp/audit-1017/seo-run1.txt / seo-run2.txt  SEO 判据两遍（各 207 PASS / 0 FAIL）
```

凭据处置：本次未读、未打印、未落盘任何 `.env` / 连接串 / token。`scripts/check-billing-out-of-build.mts` 会自行读 `process.cwd()/.env` 注入 env（本次**未执行**它）；所有命令输出都只落 `/tmp/audit-1017`，未包含凭据值。
