# 界面与交互评审 · 8aa164a^..327d6c7（10-03 ~ 10-17，73 提交）

仓库实际路径：`/Users/xiaoxiaobai/code/xiaobaic-review`（任务给的 `xiaobaic` 拼错了 home 目录）。
HEAD = `327d6c7`，tracked 文件无本地改动（`git status` 只有 `?? .superpowers/`、`?? design/`），所以文中行号既是提交态也是磁盘态。全程只读，未改任何文件、未跑 build、未碰 `.next`。

判级口径：阻断 = 我按代码链路走查过、能写出确定点击路径的；重要 = 一定错但要条件/频率；次要 = 打磨项。

---

## 阻断（含点击路径）

### U1 点击任何 Web Push 通知都落到 404
`public/sw.js:57,68,73,76,85`（路由映射）+ `public/sw.js:59` 与 `src/lib/notifications.ts:382`、`src/lib/comment-helpers.ts:263`、`src/lib/upload-notifications.ts:59`（payload 来源）

现象：`notificationclick` 里 `let url = '/admin'`，`ADMIN_ACCESS`/`SECURITY_ALERT` → `/admin/security`，`CLIENT_COMMENT`/`VIDEO_APPROVAL`/`CLIENT_UPLOAD`/`SHARE_ACCESS` 无 `data.url` 时 → `/admin/projects/<id>`。而本仓库 `src/app/admin` 目录不存在，`next.config.*` 无 `basePath`/rewrite（已核）。服务端只有 3 个发送点带 `pushData.url`（评论、客户上传、通过），其余类型不带，必走 `/admin` 兜底。

为什么：早期后台叫 `/admin`，路由改名成 `/studio` + `/platform` 时 SW 里这份表没跟着改；`sw.js` 是 public 静态文件，TypeScript 和路由检查都盖不到它，所以它能一直带着死路径上线。

点击路径：①登录 → 设置里开启浏览器推送（`src/components/settings/WebPushSection.tsx`）②另一台设备/账号触发一次「管理员登录」或「安全提醒」（`src/app/api/auth/login/route.ts:114,160` 就是这两类）③系统通知弹出，点它 → 期望进 `/platform/security`（或 `/studio/projects`）；实际 `url='/admin/security'` → 命中 `src/app/not-found.tsx` 的 404 页。

严重度：阻断。修法方向：映射表改成 `/platform/security` 与 `/studio/projects/<id>`，或者干脆让服务端每类都必带 `data.url`、SW 只在有 url 时跳转（后者把口径收在一处，符合 U28 的同一原则）。谁能修：前端会话可改映射；服务端补 url 属通知链路，建议同一批做完。

### U2 审片页自动按浏览器语言选中，但正文不跟着换
`src/components/LanguageToggle.tsx:41-61`（自动检测分支）vs `:67-75`（手动分支才 dispatch）+ `src/components/ShareLocaleProvider.tsx:33-48`

现象：只有 `changeLanguage()`（手动选）会 `dispatchEvent('shareLocaleChange')` 并写 `localStorage.shareLanguage`；`init()` 里自动命中浏览器语言时只 `setLocale()` + `onChange?.()`。而唯一会换 messages 的是 `ShareLocaleProvider`，它只听那个自定义事件、或读 localStorage。自动路径既不 dispatch 也不落库 → 提供器永远停留在服务端语言。

为什么：两处各自实现「谁来决定语言」，事件是它们唯一的桥，自动路径没上桥。

点击路径：①把浏览器语言设为 `nl`（或 `de`），且站点语言（`src/i18n/locale.ts:42` 读库，兜底 `zh`）不是荷兰语 ②打开一条审片链接 `https://vidx.cn/<code>` ③期望整页变荷兰语；实际右上角下拉显示 Nederlands、页面正文（含 `ShareExpiryNote`、口令/验证码提示、U20 那些硬编码中文）仍是中文。手动在下拉里再选一次才生效。

严重度：阻断（甲方在境外时每天都碰得到）。修法方向：`init()` 命中后也走 `changeLanguage()` 那条统一路径（或直接把 provider 的 state 提到一个 store 里，两个组件读写同一份）。谁能修：前端会话。

### U3 「创建团队」没有 in-flight 保护，能连开两个同名团队
`src/components/TeamSwitcher.tsx:103-120`（`createTeam` 无 submitting 态）、`:274-276`（Enter 提交）、`:281-283`（按钮不 disabled）

现象：`createTeam` 只有 `teamName` 空值校验，没有 `setSubmitting`，按钮和 Enter 都没有 in-flight 闸门；成功后 `await apiPost` 才 `window.location.reload()`。服务端 `src/app/api/teams/route.ts:66-103` 无幂等、无按名查重，`prisma/schema.prisma:114` 的 `name String` 不是 `@unique`。

为什么：`window.location.href`/`reload()` 这类「跳走就行」的表单最容易被漏掉禁用态；两次点击的响应回来时页面正在换，用户看不到第二次。

点击路径：①顶栏团队中心 → 创建团队 ②输入 `小白工作室` ③快速连点两下「创建并进入」（或回车 + 点一下）→ 期望建 1 个团队；实际 POST 发两次、建出 2 个同名团队，下拉里出现两行（团队数若受平台设置约束，第二个还会以报错收尾，而错误来自服务端中文硬串 `src/app/api/teams/route.ts:71`）。

严重度：阻断（数据层面长出来的脏东西，删都要手删）。修法方向：加 `submitting` state 并把 Button/Enter 一起禁用；顺带把 `:277` placeholder 与错误文案接入 i18n（见 U18）。谁能修：前端会话。

---

## 重要

### U4 首页 5 处「免费内测/免费开放」对外承诺 —— 撞红线 7
`src/app/home-client.tsx:16`(`BETA_CTA='免费加入内测'`)、`:368`、`:421`、`:425`（「内测期间所有功能免费使用」）、`:687`

为什么：`:15` 的注释写的是「不写金额，也不写档位」，于是把「免费」当成安全表达；但红线要防的是承诺本身——「所有功能免费使用」是无期限承诺，将来收任何一档都得先改首页，而搜索引擎/回答引擎已经把 `:425` 那句抓走了（`page.tsx:19` 的 description 同句又写一遍）。营销 md 六篇反而一句「免费」都没写（已核），首页是唯一的漏点。

修法方向：换成不承诺价格的表达（「现在就能开始用」「登录后按引导建团队」），并和 `content/marketing` 的口径统一。谁能修：**业主定口径**，前端会话照改。

### U5 首页「素材收录」板块自相矛盾，且与代码真实行为相反
`src/app/home-client.tsx:626`（「不用开账号，传回来就进项目」）、`:633`/`:638`（alt 与 figcaption 都写「客户不注册也能传原片」）、`:621`（「点开就能上传」）vs 同一板块 `:64`（「对方登录后直接上传」）与 `:61-62` 的代码注释

为什么：`:61-62` 的注释明确说以代码为准（`api/share/[token]/project-uploads` 有 401 分支），`:64` 也照实写了「对方登录后」，但同一屏的标题、图片 alt、图注三处都写「不注册也能传」。业主自己留下的守门注释被后面的文案改动覆盖了。

修法方向：三处统一成「对方登录后传片，看片与留言才免注册」。涉 `api/share/**` 结论 → **需业主确认**（这是禁区，我只陈述界面与注释互相打架，不建议动接口）。谁能修：业主确认后前端会话改文案。

### U6 首页正文区块在 JS 跑起来前整片 `opacity: 0`
`src/app/home.module.css:1123-1127`(`.reveal{opacity:0;transform:translateY(26px)}`) + `src/app/home-client.tsx:285-304`（进场靠 IO 加 `.revealOn`）

为什么：SSR 出的 HTML 里 `#platform`、四个 chapter、CTA 全都带着 `opacity:0`，可见性完全由客户端 JS 决定。缺 IO、缺 reduce-motion 的路径代码里有兜底（`:287`），唯独「JS 没执行/执行前」没有兜底。对营销页等于：首屏以下一片空白，同时回答引擎/爬虫读到的是被 CSS 藏起来的正文——而 `BrandLd`/canonical/`llms.txt` 这套正是为它们铺的。

修法方向：默认可见、JS 激活时才隐藏（沿用 `layout.tsx:94` 那枚 before-paint 脚本在 `<html>` 上加个 `js` 类），或改成 `animation-timeline: view()` 纯 CSS。谁能修：前端会话。

### U7 首页三处内部路由用裸 `<a>`，点一下整页刷新
`src/app/home-client.tsx:369`、`:485`、`:585`（都是 `href={dashboardHref}`，值为 `/login` 或 `/studio/projects`）

为什么：同文件 `:374,412,414,428,690` 都正确用了 `<Link>`，`<a>` 只该留给 `:402/:410` 那种外链和 `#` 锚点；这三处混进来，且它们是页面上最主要的转化按钮。后果：丢掉 Next 的路由状态与预取，登录页每次整页重载（`login/page.tsx` 是 `use client` + `Suspense`，SSR 还要跑一遍 prisma/favicon 查询）。`:711-713` 的页脚已经把「`#` 用 `<a>`、其余用 `<Link>`」写成了正确范式，照它改即可。修法方向：换 `<Link>`。谁能修：前端会话。

### U8 登录弹窗里「忘记密码？」是裸 `<a>`，整页刷新把审片现场冲掉
`src/components/ReviewLoginActions.tsx:420`（对照正确写法 `src/app/login/page.tsx:403` 的 `<Link>`）

为什么：这枚组件只出现在审片/分享页（`src/app/share/[teamSlug]/SharePageClient.tsx:1416,1441,1493,1557` 与 `src/app/studio/projects/[id]/share/page.tsx:985,1047`），点它的人正在看片。整页刷新会丢掉播放位置、批注草稿和已加载的 token 缓存（`SharePageClient.tsx:294-301` 那几枚 ref 全在内存里）。修法方向：换 `<Link>`，或走 `router.push` 带 `returnUrl`。谁能修：前端会话。

### U9 登录弹窗没有焦点陷阱
`src/components/ReviewLoginActions.tsx:370-455`（`role="dialog" aria-modal="true"` + `createPortal`，Esc 见 `:174-181`）

为什么：Esc 有、`aria-modal` 有，但焦点是自己 portal 手搭的，Tab 序列仍然走完整份文档——审片页背后那一整排控件（视图切换、语言、主题、评论框）都在遮罩后面可被 tab 到、可被回车触发。对照本项目自己的标准件：`src/components/ProjectOverlay.tsx:28-30` 明确写了「走 Radix 原语，焦点陷阱/滚动锁/Esc 只关最上层/焦点归还这四件事别复制第二遍」。这个弹窗正是「复制了第四遍」的那个。修法方向：换成 `Dialog`/`DialogContent`，或补 `@react-aria/focus` 之类陷阱。谁能修：前端会话。

### U10 头像下拉菜单点页面别处、按 Esc 都关不掉
`src/components/ReviewLoginActions.tsx:345-361`（`profileOpen` 面板）；`:332` 打开、只有 `:351,354,357` 三个菜单项点击会 `setProfileOpen(false)`

为什么：没有 `mousedown`/`click` 外部监听，`:174-181` 的 Esc 只在登录弹窗 `open` 时挂，管不到这枚菜单；`aria-expanded`/`aria-haspopup` 写对了（`:338-339`）却没有对应的关闭路径，状态与语义各说一半。同仓库的 `TeamSwitcher.tsx:62-71` 就自己写了 outside-click，可见口径不统一。

点击路径：登录（任意方式）→ 点右上角头像出菜单 → 点页面空白处/评论框 → 期望菜单收起；实际菜单常驻，且再点视频区域也不会关（只有点中三个菜单项之一才关，而其中「个人中心」是 `<Link>` 会跳走）。

修法方向：抽一个 `useDismissable({open,onClose})`（outside-click + Esc + `role=menu` 键盘导航），这枚和 U38 那枚一起用。谁能修：前端会话。

### U11 登录方式切换器 `role="tablist"` 用错，读屏听不出当前选中
`src/app/login/page.tsx:336-352`；同款 `src/components/ReviewLoginActions.tsx:404-409`

为什么：容器声明了 `role="tablist"`，两个 `<button>` 既没有 `role="tab"`、也没有 `aria-selected`/`aria-controls`，选中态只靠背景色（`:340,347` 的三元 className）。tablist 语义还额外要求左右键切换，这里只有 Tab。等于把 ARIA 用成了「只报有 2 个标签页、不报在第几个」。修法方向：要么去掉 tablist 当普通切换组（`role="group"` + `aria-pressed`），要么补齐 tab 语义。谁能修：前端会话。

### U12 登录密码框 `autoComplete="new-password"`，把用户已存的口令挡在门外
`src/app/login/page.tsx:397`（同款 `src/components/ReviewLoginActions.tsx:418`）

为什么：`new-password` 是给注册/改密用的语义，浏览器与密码管理器据此**不提供**已存凭据填充；登录页该用 `current-password`。代码同时挂了 `data-lpignore`/`data-1p-ignore`（`:398`）+ `name="site-login-password"`，看得出意图是防管理器填错字段——但这两件事该由 `name`/`data-*` 完成，不该拿 `autocomplete` 开刀，代价是 1Password/Chrome 之外所有正常用户也一并失去填充。同项目 `src/app/profile/page.tsx:723` 就正确用了 `current-password`，说明是漏改。修法方向：登录用 `current-password`，挡管理器的诉求保留 `data-*-ignore`。谁能修：前端会话（若「故意不让自动填充」是业主决定，请标 **需业主确认**）。

### U13 登录页/审片弹窗里品牌名硬编码中文
`src/app/login/page.tsx:276`、`:297`、`src/components/ReviewLoginActions.tsx:377`（三处 `逐帧审阅`）

为什么：整页都在 `useTranslations`，品牌却写死。站点语言切到 en/de/nl 时，登录卡片左侧那行品牌名仍是中文，而相邻 `BrandLogo` 与 `src/lib/marketing/brand.ts:4-11` 已经有 `BRAND.en`/`BRAND.zh` 可用。修法方向：引 `BRAND[locale] ?? BRAND.zh`，别再抄第三份（`:377` 与 `:276` 已是两份）。谁能修：前端会话。

### U14 忘记密码页整句中文硬编码（四语用户看不到这条出口）
`src/app/forgot-password/page.tsx:123-124`

为什么：这句是「手机号账号不用重置密码，回去走验证码登录」——专门给手机号注册的人指的出口，而 `4f04fb7` 那次提交的目的正是「给登录页补出口、电话优先的错误文案」。链路其余部分都 i18n 化了，唯一一句兜底说明写死。修法方向：挪进 `auth` 命名空间四语补齐（本项目 key 对齐目前 100% 干净，见文末）。谁能修：前端会话（译文口径可请业主过一眼）。

### U15 重置密码页把密码规则写死两份，且与已存在的本地化键重复
`src/app/reset-password/page.tsx:52`（`` `新密码不符合要求：${passwordRuleHint}` ``）+ `src/lib/password-policy.ts:14`（`passwordRuleHint` 中文常量，被 `:173` 与 `src/components/PasswordRequirements.tsx:13` 直接渲染）

为什么：`profile.passwordRuleUnmet`（含 `{hint}`）和 `profile.passwordRule` 四语都已存在（值已核：en "The new password does not meet the rule: {hint}"），`src/app/profile/page.tsx:441,672` 走的是本地化，重置密码页走的是硬编码。同一件事两份来源，改口令规则时只会改到一处；非中文用户在重置流程里读到的是中文规则 + 中文报错。另 `password-policy.ts:71-107` 的 `errors[]` 是英文句子，谁渲染它们谁就漏英文。修法方向：`passwordRuleHint` 只留给服务端日志/内部，界面一律走 `profile.passwordRule*`。谁能修：前端会话。

### U16 重置成功后 2 秒定时器没清理，点浏览器后退会被强推回 /login
`src/app/reset-password/page.tsx:74-77`

为什么：`setTimeout` 未持有 id、effect 也无清理，组件已经卸载它照样执行。用户看到「密码已重置」后按后退（或点了 `:119` 那条「申请新链接」——成功态下它虽隐藏，后退/已打开的别的标签还在）→ 2 秒后被 `router.push('/login')` 拽走。修法方向：把延时放进 `useEffect(() => {...}, [status])` 并在清理里 `clearTimeout`。谁能修：前端会话。

### U17 重置密码页两枚眼睛按钮没有可访问名，且键盘完全够不到
`src/app/reset-password/page.tsx:163-170`、`:192-199`（`<button>` 只包 `<Eye/>/<EyeOff/>`，无 `aria-label`，且 `tabIndex={-1}`）

为什么：口令可见性切换是安全相关操作，读屏只报「按钮」，键盘用户因为 `tabIndex={-1}` 根本 Tab 不到。同项目 `src/components/ui/password-input`（登录/个人中心用的那个）是有名字的——`ReviewLoginActions.tsx:386` 也正确写了 `aria-label={ta('closeLoginDialog')}`，说明口径存在，这两处是漏的。修法方向：改用现成的 `PasswordInput`。谁能修：前端会话。

### U18 团队切换器整组件零 i18n（22 行可见中文）
`src/components/TeamSwitcher.tsx:38-41,45-46,106,118,135,141,161,169,184,212,221,236,244,252,263,268,277,282`

为什么：这是顶栏常驻控件，`aria-label="团队中心"`（`:135`）和 `N 人`（`:212`，量词没法直译）都在里面，整文件没有一处 `useTranslations`。站点语言切到 en/de/nl 后，工作台里唯一一直看得见的那颗控件是中文。修法方向：整份迁进 `team` 命名空间；`:212` 的人数用 `t('memberCount',{count})` 让译文自己决定语序。谁能修：前端会话（工作量大，可排一次专门 PR）。

### U19 分享链接面板整面板零 i18n
`src/components/ShareLinksPanel.tsx:33-36,45,50,79-86,124-136,144-147,155,159`（表头/状态/权限/倒计时/确认框全硬编码）

为什么：与 U18 同性质；`:45`「长期有效」、`:50`「剩 N 天」、`:124,132` 的 `appConfirm` 句子都是业主每天看的运营信息，切语言后仍然中文。修法方向：同 U18 一起纳入一次 i18n 专项。谁能修：前端会话。

### U20 访客侧过期提示硬编码中文，而它就在语言切换器旁边
`src/components/ShareExpiryNote.tsx:16`（`… 失效`）、`:18`（`还能查看 N 次`），渲染点 `src/app/share/[teamSlug]/SharePageClient.tsx:1476,1556`，同行就有 `:1495` 的 `<LanguageToggle />`

为什么：这是访客唯一会读的「这条链接什么时候作废」，同一条工具行左边是中文提示、右边是可切 4 语的切换器。`toLocaleString(undefined, …)`（`:16` 与 `ShareLinksPanel.tsx:30`）又拿浏览器语言排版，于是同一条链接的日期用甲方浏览器格式、文字用中文。修法方向：接 `share` 命名空间（`share.*` 里相关键存在，见文末核查）。谁能修：前端会话。

### U21 项目设置内容被挂两遍，隐藏那一份照发请求
`src/components/ProjectSettingsPanel.tsx:566-574`（移动端三份 `CollapsibleSection`）与 `:581-614`（桌面端同一份 `*Content` 再挂三遍）；其中 `:414-418` 的 `<RecipientManager/>` 在挂载时发两次请求（`src/components/RecipientManager.tsx:68-70` 收件人 + `:79-98` 公司联系人）

为什么：`projectDetailsContent/clientInfoContent/clientShareContent` 是同一份 JSX 元素，被两个断点各渲染一次（一个 `lg:hidden`、一个 `hidden lg:flex`，都在 DOM 里）。`CollapsibleSection` 收起时不渲染 children（`src/components/ui/collapsible-section.tsx:70-74`），所以：桌面上移动端那份收起 → 暂无重复；**窄屏上桌面那份是 `collapsible={false}` → 一直渲染**，用户一展开移动卡片，DOM 里就同时出现两个 `id="title"`/`"maxRevisions"`/`"dueDate"`/`"clientCanApprove"`…，`<Label htmlFor>`（`:262,307,342,442`）指向第一个匹配项、`aria-controls` 也只认一个，属于「无效 HTML + 关联随机」。数据层则是每次开窗多打 2 个接口。修法方向：一份 DOM，靠 CSS 断点决定折叠行为（或 `useMediaQuery` 二选一渲染）。谁能修：前端会话。

### U22 项目设置的载入 effect 依赖 `t`，`router.refresh()` 后会盖掉未保存的编辑
`src/components/ProjectSettingsPanel.tsx:104-148`（deps `[projectId, t]`）+ `:229`（保存流程里自己调 `router.refresh()`）

为什么：根 layout 是 `force-dynamic`（`src/app/layout.tsx:20`），refresh 会重新 `getMessages()` 并把新 `messages` 对象塞进 `NextIntlClientProvider`（`:95`）；next-intl 的 translator 是 `useMemo` 依赖 `messages` 的（`node_modules/use-intl/dist/esm/development/react.js:88-98`），于是 `t` 换身份 → effect 重跑 → 整份表单被服务端值覆盖。同项目 `src/app/profile/page.tsx:292-294,314-316,484-485` 已经把这条写成了明确约定（「t 每次渲染都换身份…别塞进依赖数组」并 disable 该行 lint），这个新文件走了相反写法——两套口径并存，下次改动只会再漏一处。修法方向：`t` 移出依赖，错误文案存 key 再渲染。谁能修：前端会话。

### U23 个人中心用 300ms 轮询 + 强制布局读取，永不停止
`src/app/profile/page.tsx:469-486`（`setInterval(recompute, 300)`，内部 `getElementById`×3 + `getBoundingClientRect()`）

为什么：注释说的是内嵌浏览器（飞书/微信 IAB）不吃 window scroll，这个理由成立，但代价是每 300ms 三次同步布局读取，一直转，用户不动也转，页面在后台也转（`clearInterval` 只在卸载时）。`sectionTitle` 字符串相同则 React 不重渲染，所以是纯 CPU/功耗损耗，移动端明显。修法方向：保留轮询但把三段 top 缓存进数组、改用 `IntersectionObserver`（阈值 + rootMargin）驱动，或至少 `document.hidden` 时暂停。谁能修：前端会话。

### U24 个人中心「返回」按钮是裸 `<a>`
`src/app/profile/page.tsx:500`（`<Button asChild><a href={visibleReturnUrl || …}>`）

为什么：`asChild` 只是把样式并到子元素上，不会把 `<a>` 变成客户端跳转，站内路由 `@/app/studio/projects/...`、`/` 全走整页刷新；同文件 `:351`（另一处的 `<Link>`）和 `ProjectSettingsPanel.tsx:705` 都用的 `<Link>`。修法方向：`<Button asChild><Link href=…>`。谁能修：前端会话。

### U25 解绑飞书用 `window.confirm`，内嵌浏览器里点了没反应
`src/app/profile/page.tsx:396`

为什么：这一页正是给「用飞书登录/通知」的人用的，而他们大概率在飞书内置浏览器里；IAB 常常吞掉 `window.confirm` 并直接返回 falsy → 按钮看起来坏了。项目里已经有统一口径 `appConfirm`（`src/components/AppDialogProvider.tsx`，同文件 `ProjectMembersPanel.tsx:108-113`、`ShareLinksPanel.tsx:124` 都在用它），`:396` 是唯一的例外。修法方向：换 `await appConfirm({…})`。谁能修：前端会话。

### U26 头像上传控件没有可访问名，触控目标 28px
`src/app/profile/page.tsx:541-550`（`<label class="h-7 w-7">` 里只有 `<Camera/>`，`<input type=file class="sr-only">` 没有 `aria-label`）

为什么：读屏走到这里只听到「文件上传」不知道是改头像；`h-7 w-7` = 28×28，明显低于 44px，而个人中心是手机上改名字的入口页。对照 `ProjectOverlay.tsx:60` 的 `h-[44px] w-[44px]` 与 `aria-label={tc('close')}`，同项目已有正确做法。修法方向：给 input 加 `aria-label`（或 hidden 文案），点区域扩到 ≥44px（视觉仍可 28px，用 padding/伪元素扩）。谁能修：前端会话。

### U27 营销页写死了只有代码里才有的额度与时限（两处各写一遍）
`content/marketing/compare--fenzhen.md:64`、`compare--frame-io.md:25`、`features--share-link.md:44`（「单个文件默认 1 GB」「默认 10 个，上限能调到 500」）、`features--versions.md:44`（回收站 7 天）、`src/app/home-client.tsx:66`（7 天）、`:71`（文件夹最多 5 层）
对应代码单源：`src/lib/recycle-bin.ts:8`(`RECYCLE_BIN_RETENTION_MS=7d`)、`src/lib/project-folders.ts:15`(`MAX_FOLDER_DEPTH=5`)、`src/app/api/settings/route.ts:261-264`(1–500)、`maxUploadSizeGB ?? 1`（`src/app/api/share/[token]/project-uploads/route.ts:106` 等）

为什么：今天两处数字是对得上的（我逐条核过），但「默认 1 GB / 默认 10 个」是**可由平台设置改动**的值（`src/app/platform/settings/page.tsx:146,626`），运营把默认改成 2 GB 或 5 个，四个对外页面立刻变成假承诺；红线 7 也本意就是不写我方额度。修法方向：营销页改成「上限可在平台设置里调，以你建好团队后看到的那一屏为准」（`compare--fenzhen.md:24` 已经这么写了，照它统一）。谁能修：**业主定口径**后前端/文稿会话改。

### U28 「长期有效 / 已停用」这一份事实被抄了 7 个文件
`src/components/TeamSwitcher.tsx:43-47`、`src/components/TeamOverview.tsx:40-42`、`src/components/AdminHeader.tsx:27`、`src/app/studio/team/page.tsx:44-46`、`src/app/studio/projects/[id]/page.tsx:280-289`、`src/app/platform/teams/page.tsx:25-27`、`src/app/platform/page.tsx:13-15`；闸门逻辑在 `src/lib/platform-access.ts:21`

为什么：七份同语义字符串（全部硬编码中文，见 U18/U19），而 `src/app/studio/projects/[id]/page.tsx:280` 还额外多写一份 `plan:'免费内测'`——这正是红线 7 要防的那种内部词。将来内测结束改口径要同时点七把火，漏一处就出现「A 屏说长期有效、B 屏说已过期」。另外 `src/components/ShareLinksPanel.tsx:45` 把「长期有效」用在**分享链接**的有效期上，同词两义。修法方向：抽 `src/lib/team-status-copy.ts` 一处出词，分享侧换词（如「不设期限」）。谁能修：前端会话（口径归业主，见 U4）。

---

## 次要

### U29 `public/sw.js`：旧品牌名 + 拦截了但从不写缓存 + 推送兜底英文
`public/sw.js:1`(`CACHE_NAME='vitransfer-v1'`)、`:106-117`（fetch 走 network-first，`caches.match` 兜底，但全文没有一次 `cache.put/add` → 兜底必 miss → `Response.error()`）、`:31,36`（`'You have a new notification'`）、`:49`（标题兜底 `'FrameReview'`）
为什么：`:1` 是公开产物里还能翻到的旧品牌名（红线 7 字面命中，但对用户不可见；`src/locales/*.json` 的 `common.viTransfer` **值已是 FrameReview**，不算违规，只是键名旧，别顺手改）。拦截器只做了一件事：把离线导航变成浏览器错误页，一点离线可用性都没换来。修法方向：要么给静态资源加真实缓存版本，要么整段 fetch 删掉；推送兜底文案换成本地化后由服务端下发（U1 同一处改）。谁能修：前端会话。

### U30 `sw.js:107` 同源判断用 `url.startsWith(self.location.origin)`
`https://vidx.cnevil.com/…` 这类前缀重合的 host 会通过检查（安全相邻、只读发现，实际影响有限，因为没有任何缓存可被读到）。修法方向：`new URL(url).origin === self.location.origin`。**需业主确认**（要不要顺带动 SW 的安全边界）。谁能修：前端会话。

### U31 首页 hero 下方区块的进场依赖「一次查询」
`src/app/home-client.tsx:285-304` 在 mount 时 `querySelectorAll('.' + styles.reveal)` 快照，之后新增的 `.reveal` 节点不会被观察。当前页面是静态 JSX，碰得到；配合 U6 一起修更稳。谁能修：前端会话。

### U32 首页「登录」入口在会话校验完成后才出现，顶部右侧会跳一下
`src/app/home-client.tsx:411-414`（`authChecked && !user` 才渲染）+ `:414` CTA 文案由 `BETA_CTA` 切成「进入工作台」
为什么：`:327-340` 的 `/api/auth/session` 往返期间这块宽度是空的 → 头部布局位移（CLS），同时 CTA 文字换一次。修法方向：先占位（invisible 而非 unmount），CTA 文案在未定时用中性词。谁能修：前端会话。

### U33 图片/图标显式宽高这块做得好，但品牌 logo 没 `priority`
`src/app/home-client.tsx:375,700`（`/brand/logo.png` 26/22 定宽高，无 `priority`，首屏会晚一轮请求）。其余三张截图（`:496,531,632`）都有 `width/height` + 折叠下懒加载，`<video>` `:440-441` 也带了 1600×900——这块整体没问题，只提 logo。谁能修：前端会话。

### U34 首页图片 alt 里写死了截图内的人数/条数
`src/app/home-client.tsx:532`（「12 条素材、20 个版本」）、`:498`、`:633`
为什么：换一张截图这些数字就假了，而 alt 是被搜索引擎当事实读的。修法方向：alt 描述界面元素，不报数。谁能修：业主/文稿会话。

### U35 「6 位验证码」两把钥匙两条文案
`src/locales/zh.json` 里 `auth.invalidCode` 与 `auth.verificationCodePlaceholder` 的中文值逐字相同（en 也几乎相同），`src/app/login/page.tsx:202-204` 当一个用、`:417` 当另一个用，`src/app/profile/page.tsx:726,763` 把它们当占位符、`:259` 又当错误。修法方向：合成两把语义清楚的键（错误/占位各一），别再混用。谁能修：前端会话（i18n 键治理专项）。

### U36 审片工具行多个 32–36px 触控目标
`src/components/ShareViewToggle.tsx:35`(`h-9` 内两枚图标按钮)、`src/components/LanguageToggle.tsx:83`(`h-9` select)、`src/components/ReviewLoginActions.tsx:335`(compact `h-9 w-9`)、`src/components/ProjectMembersPanel.tsx:185`(`h-[32px] w-[32px]`)、`src/components/ShareLinksPanel.tsx:159`(`h-8 w-8` 一排)
为什么：这些恰好都在手机上打开的审片页/分享管理页；`ProjectOverlay.tsx:60` 已是 44px 正例。修法方向：给这排控件统一 `min-h-11`（视觉尺寸不变、扩 padding）。谁能修：前端会话。

### U37 被禁用的「移除成员」按钮用 `title` 解释原因，实际看不见
`src/components/ProjectMembersPanel.tsx:182-183`（`disabled={!member.canRemove}` + `title={…BlockedHint}`）
为什么：多数浏览器不对 disabled 元素派发 hover，那句「为什么撤不动」正好在最需要的时候不出现；读屏也不保证读 `title`。同文件 `:175-176` 的注释说明设计意图就是「给 disabled＋原因」，实现没接上。修法方向：原因写成行内可见的小字或 `aria-describedby` 的可聚焦提示。谁能修：前端会话。

### U38 团队下拉没有 `aria-expanded`/`aria-haspopup`，也不吃 Esc
`src/components/TeamSwitcher.tsx:128-137`（trigger 只有 `aria-label`）、`:154-256`（面板无 role/无键盘导航）；`:62-71` 只有 outside-click
为什么：与 U10 是同一类缺陷的另一半：这枚有外部点击关闭但没有 Esc 和展开语义。修法方向：和 U10 合并成一个 `useDismissable`。谁能修：前端会话。

### U39 退出登录不检查微信会话 DELETE 是否成功，网络恢复后可能「又登录了」
`src/components/ReviewLoginActions.tsx:300-308`（`if (session?.authenticated) await fetch(… {method:'DELETE'})` 无 try/catch，随后本地一律清空），而 `:152-162` 在 `focus`/`visibilitychange` 时会重新 `refreshSession()`，服务端仍以 `wechat_session` cookie 判登录（`src/lib/auth.ts:564-577`）
为什么：离线或 5xx 时本地清了、cookie 没清，切回这一页就把自己「重新登录」回去。严重度取决于失败概率，所以列次要；`notifyReviewAuth(false)` 已发的事件也会被下一次 `:138` 覆写回 true。修法方向：DELETE 失败就走 `/api/auth/logout` 重试或明确提示「未完全退出」。谁能修：前端会话（若牵涉 cookie 语义 → **需业主确认**）。

### U40 错误分支：登录接口拿到非 JSON 响应时报「请稍后重试」，真因丢失
`src/app/login/page.tsx:249`（`await response.json()` 无 `.catch`）对比 `:172`、`:216` 都写了 `.catch(() => ({}))`；`src/components/ReviewLoginActions.tsx:198,273` 同样无 catch，并把 `data.error` 直接当 `throw new Error(...)` 的 message（`:199`）
为什么：网关 502 返回 HTML 时，走 `:263` 的兜底 → 用户看「请稍后重试」，业主看的是 nginx 而不是应用；这是「把基础设施抖动报成用户问题」的温和版。修法方向：统一 `parseJsonSafe`，非 2xx 保留 status 并分类提示。谁能修：前端会话。

### U41 `ProofStrip` 的开发态占位格是产品可见文案的埋雷
`src/app/home-client.tsx:151-170`（`SHOW_PROOF_SLOT = NODE_ENV !== 'production'`，空数组时画三格「数据位：内测数据补齐前…」）
为什么：生产不渲染这点做对了，但 `:162` 的 `key={`${stat.value}-${i}`}` 用了下标，且将来真补数据时这段 dev-only 分支很容易被当成「已经验证过的界面」直接上生产。修法方向：补数据时把占位分支删掉。谁能修：业主（数据到位之前别动）。

---

## 扫过但没问题的面（覆盖清单）

1. **四语字典对齐**：脚本扁平化比对 `zh/en/de/nl` 全部叶子键——**互相缺键 0 个**；空值仅 3 把且四语一致（`settings.emailTemplates.placeholderExamples.{SUMMARY_ITEMS,SUMMARY_PROJECTS,UNSUBSCRIBE_SECTION}`，是模板占位说明、非界面文案）。键序/类型不一致 0 处（无 array↔string 漂移）。`src/i18n/locale.ts:69-101` 还做了「英文打底 + deepMerge」，所以缺键会退化而不是把键名画到界面上。
2. **界面用到的键**：对 home-client、login、forgot/reset-password、profile、ReviewLoginActions、ProjectSettingsPanel、ProjectMembersPanel、TeamSwitcher、Share{Links,Expiry,View,Locale,Photo}Panel、SharePageClient 抽出全部 `t/ta/tc/t.rich` 调用并逐键查四语存在性与 `{placeholder}` 集合一致性——**0 缺键、0 空值、0 插值参数不匹配**（含 `projectMemberCount`、`codeSentToNew`、`resendIn`、`feishuBoundAs`、`passwordRuleUnmet`）。
3. **响应式基座**：`home.module.css:10,337` 与 `login/page.tsx:270-271`、`ProjectOverlay.tsx:51` 用的是 `svh/dvh` + `calc(100% - 2rem)`/`min()`，没有裸 `100vh`；断点 1080/960/720 三档，`.row/.pointCols/.footerGrid/.stepsRow` 都按档回落到单列，`:1212-1214` 窄屏主动收起「联系我们」，未见固定像素溢出。
4. **减少动效**：`home.module.css:1274-1299` + `home-client.tsx:287,308-325` 两处都读 `prefers-reduced-motion`，`arc*` 动画、录屏 autoplay（`:314` 明确不播、停在 poster）、`.reveal` 位移三条都覆盖到；滚出视口暂停 GPU（`:198-210`）也做对了。
5. **图标按钮可访问名（大部分）**：`ReviewLoginActions.tsx:386` 关闭、`:337-339` 头像（`aria-label`+`aria-expanded`+`aria-haspopup`）、`ProjectOverlay.tsx:59` 关闭、`ShareViewToggle.tsx:40-41,49-50` 双按钮 `title`+`aria-label`、`ProjectMembersPanel.tsx:184` 移除、`home-client.tsx:450` 向下箭头、`:254,599,668` 装饰图标 `aria-hidden`——这批是对的；漏的是 U17/U26 两处。
6. **重复提交保护（大部分）**：`login/page.tsx:465`、`ReviewLoginActions.tsx:435`、`forgot-password/page.tsx:102,109`、`reset-password/page.tsx:160,189,206`、`ProjectSettingsPanel.tsx:658`、`profile/page.tsx:578`、`ProjectMembersPanel.tsx:92,106,182,226`（`busyId` 单飞，写得最规范）都有 in-flight 禁用；唯 U3 的建团队没有。
7. **网络抖动不当「没登录」**：`ReviewLoginActions.tsx:110-123` 这一段是全场最好的——catch 直接 return 保留已知状态、`5xx ≠ 401` 才认作答案、`:96-99` 用 ref 稳住父级内联回调。`home-client.tsx:327-340` 的 `cancelled` 卸载守卫、`TeamSwitcher.tsx:73-90` 同样正确。
8. **`key` 用法**：全场未见用数组下标做动态列表 key（`ProjectMembersPanel.tsx:158,213` 用 id、`DocPage.tsx:92` 用 `f.q`、`home-client.tsx:666-671` 的 `index+1` 只是 `aria-hidden` 的序号显示，不是 key）；唯一下标 key 是 U41 那个静态占位。
9. **`(marketing)` 路由与守门**：`features`/`compare` 用显式目录避开与根级 `[shareCode]` 抢段（`(marketing)/features/page.tsx:5-7`）；`content.ts` 的前言校验（`:46-89`，文件名↔slug/group 一致性、CTA 走 `isAllowedHref` 挡 `javascript:`、`:148-151` 连 `//host` 与 `\host` 都挡了）、渲染器「先转义再按子集构造标签」（`:132-177`）都成立；`related` 查不到时 `.filter` 跳过（`DocPage.tsx:69-71`），不会把 `compare/xxx` 这种内部键名画出来。
10. **SEO/metadata 一致性**：`page.tsx:18-28`、`(marketing)/layout.tsx:12-25`、`HubPage.tsx:22-41`、`DocPage.tsx:18-43` 每层都重写了 `openGraph.images` 与 `robots.index+follow`（子级整体替换这条坑守得一致），`metadataBase` 只在营销层取（`site-url.ts:53-62` 的注释解释得通），`SiteUrl` 非 production 才允许退路且不写 `cached`（`:34-36`）——没有发现把 HTML 缓存或把 canonical 指错域的界面级问题。
11. **营销文稿红线（除 U4/U27 外）**：六篇 md 里我方价格 0 处、我方席位数 0 处、`vitransfer` 0 处；「不卖部署、不卖托管」三处都是**否定**句式（`compare--fenzhen.md:30`、`compare--frame-io.md:57`、`compare--netdisk-wechat.md:59`），方向正确；竞品价格/条款都带「依据 URL + 核实于 2026-09-20」，读不到明说读不到。
12. **`ProjectOverlay`/`ProjectMembersPanel` 两个新窗**：焦点归还（`:48-49` 用 `onOpenAutoFocus` 记 opener、`onCloseAutoFocus` 还回去）、Radix 原生陷阱、Esc 只关最上层、44px 关闭键、`subtitle` 人数与页面读数同源（`ProjectMembersPanel.tsx:138` + `:79-83` 写完即重取）——这一对是这次改动里做得最好的部分，建议把 U9/U10 那两扇手搭弹窗并进来。

**禁区声明**：`src/app/api/share/**` 只读引用了三处（U5 的 401 分支、U27 的 `maxUploadSizeGB` 兜底、U39 的 cookie 判登录），只用于说明界面文案与既有行为的关系，**均未建议修改该目录**。牵涉它的两项已标「需业主确认」。
