---
{
  "group": "compare",
  "slug": "frame-io",
  "title": "Frame.io 的中文可用替代",
  "description": "Frame.io 有简体中文站，也有逐帧批注和免注册分享链接。这一页只写国内团队确实能对上的几处摩擦：带宽、登录、中文程度、意见落点，以及什么时候还是该选它。",
  "h1": "Frame.io 在国内用起来别扭的地方",
  "updatedOn": "2026-10-03",
  "sections": ["访问与上传", "登录方式", "中文界面与中文通知", "批注落点", "什么时候仍然该选 Frame.io", "数据放在哪"],
  "cta": { "href": "/login", "label": "登录后建一个团队，传一条片子试" },
  "related": ["compare/netdisk-wechat", "compare/fenzhen"],
  "faq": [
    { "q": "国内上传一条片子到底要多久？", "a": "我们没实测，也不转述别人的截图。可靠的做法是自己测：拿 200 MB 以上的素材在办公网络传一次，第二天用同一条链接在手机浏览器再开一次，记下用时和掉了几次。任何对比页都替代不了这一步。" },
    { "q": "甲方不肯注册账号怎么办？", "a": "不需要他注册。链接带密码，他进来就默认带留言权限；看片和写意见都发生在分享链接里，定稿的「通过」由你团队自己点。要分清的是页面上「以访客身份继续」那个入口，那条路签发的会话只能看、不能写。" },
    { "q": "你们的链接权限能细到什么程度？", "a": "一条链接一档一档地设：浏览、留言、下载各自单独开关。回传原片是收录型链接的事，这类链接只带上传这一项权限，要你在后台建出来客户才有入口，交付型链接不给。每条链接还能单独设密码、到期时间和打开次数，随时置为失效。" },
    { "q": "四语界面是哪四种，谁来切？", "a": "中文、English、Nederlands、Deutsch。后台界面由管理员全局设定一次、全员生效；分享页另外给访客留了一个自选下拉，访客选过一次就记住，语言接口只返回一种可用语言时这个控件自动隐藏。" }
  ]
}
---

## 访问与上传

这一栏得先承认查不到。Frame.io 有简体中文的官网入口和客户支持站，但本次读到的官方页里没有任何中国大陆备案或境内接入节点的说明，域名也是境外的。国内打开快不快、上传稳不稳，我们没有实测，不猜；网上写「打不开」或者「完全没问题」的说法都不构成依据。（依据：https://frame.io/zh-cn/contact 与 https://support.frame.io/zh-CN/ ，核实于 2026-09-20）

我们这边能讲清的是机制：上传走分片断点续传，中断了接着传；也可以从浏览器直传到你自己配置的 S3 兼容桶；单个文件默认 1 GB 上限、可以调。客户侧看片不装东西，浏览器打开链接就能看。

## 登录方式

对方官方的建号文档列出的路径是邮箱加密码、Google 账号验证，以及「You can use your Adobe identity to create an account as well.」，企业档另有 Single sign-on。同一页正文里没有提到微信，也没有手机号验证码——这是「我们没读到」，不是「它一定没有」。但对国内团队的日常来说，差别落在成本上：同事和甲方不太愿意为审一条片子注册一个海外账号、再记一套新密码。（依据：https://help.frame.io/en/articles/9100991-creating-your-account-quick-setup-guide 与 https://frame.io/pricing ，核实于 2026-09-20）

免注册这一层我们不占便宜：对方价格页写着分享链接「which don't require them to sign up or log in」，甲方拿链接也能直接看。（依据：https://frame.io/en-us/pricing ，核实于 2026-09-20）

我们自己这边照配置说话：邮箱密码就能进；手机号验证码和微信登录要在部署里配好短信与微信的参数才可用，飞书是个人账号级别的绑定。团队内部成员走邀请，甲方拿链接进来。

## 中文界面与中文通知

这一节不许写「对方没有中文」。官方有简体中文的站点，页面标题是「您好，我们能为您提供什么帮助？ - Frame.io」，客户支持站同样有简体中文版，主页标题写的是 Frame.io 客户支持。至于中文覆盖到不到批注标签和通知文案那一层，这两页的正文本次没有逐条读，我们不敢替它下结论。（依据：https://frame.io/zh-cn/contact 与 https://support.frame.io/zh-CN/ ，核实于 2026-09-20）

我方的口径是另一套：后台界面语言由管理员设一次、全员生效，可选中文、English、Nederlands、Deutsch；分享页按访客的浏览器语言自动选中，浏览器是中文的访客打开就是中文。批注归类用的是「画面 / 声音 / 字幕 / 剪辑 / 其他」这五种中文标签，邮件按每个联系人的语言偏好发送。

## 批注落点

逐帧不是差异点。对方价格页从 Free 档起就写着「Frame-accurate & range-based comments」，同档还列了 Annotations、Comment attachments、Document Markup（依据：https://frame.io/pricing ，核实于 2026-09-20）。把意见钉在第几帧上，两边都做得到。

差别在钉住之后接什么。我们的意见锚在带帧号的时间码上，支持 29.97 与 59.94 丢帧，画面跳转精度到四分之一帧；按时间码归集成列表，可以回复、可以标成已完成；每条意见挂的是具体版本。再往后是一道版本门禁：未通过的版本拿不到原画质也拿不到下载，通过之后才放行。甲方留下一句「三号镜头偏色」，落在第几帧只是开头，在我们这边它还要再落到某个版本的门里。

## 什么时候仍然该选 Frame.io

它的几条强项是硬的，别绕。Adobe 生态回挂：用 Adobe 身份建号，Pro 档明写 Premiere integration 与 Final Cut Pro integration。企业安全与合规档位：Forensic Watermarking、Digital Rights Management、Session-based watermarking、Single sign-on、Enterprise SLA、Dedicated account manager，都在价格页相应档位上（带限定条件的条目以官方条款为准）。现场直传：Camera to Cloud，加上集成页列出的 RED、Atomos、Teradek、FUJIFILM、Panasonic LUMIX、Canon、Nikon、Leica 这些设备，以及 Platform API 与 C2C API。字幕与转写：Transcription and captions 在 Free 档就有。再往外一层是海外协作——团队和甲方都在境外、合同和时区都在那边时，它的账号体系反而是顺的那一个。（依据：https://frame.io/pricing 与 https://frame.io/integrations ，核实于 2026-09-20）

换句话说：一家后期公司如果本来就在 Adobe 合同里、要 DRM 与会话级水印、拍摄现场的机器直接上云，选 Frame.io 是省事的那条路。我们替代的是国内团队碰到的那几处摩擦，不是它的全部。

## 数据放在哪

对方的公开口径是云端席位制：Free 档「$0」、「Up to 2 members」、「2GB storage」、「Up to 2 projects」；Pro 是「$15 per member per month + tax」；Team 是「$25 per member per month + tax」；Enterprise 标 Custom。按人按月、以美元计、另加税，存储随成员数叠加。数据归属那一栏，企业版列了 Storage Connect，各档另有 Mounted Storage 条目；私有化或本地部署的官方条款我们没读到——没读到不等于没有。（依据：https://frame.io/pricing ，核实于 2026-09-20）

我方：代码是 AGPL-3.0，可以自行构建部署，素材落在本地磁盘或你自己配置的 S3 兼容桶里，意见和版本记录跟你的库在一起。两边给的不是同一种承诺：对方卖的是带企业存储接口的云端服务，我们给的是一套可以拿在自己手里的东西，不卖部署、不卖托管。
