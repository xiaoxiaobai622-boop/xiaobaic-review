-- 用户反馈的「类型」独立成一列（10-18 点单第 1 条）。
--
-- 之前那一列不存在，窄栏「提交反馈」弹窗里选的类型是拼在正文开头那一行送进来的
-- （`类型：功能建议\n正文…`）。那样有三处对不上：运营后台读不出类型（只能靠人眼看第一行）、
-- 按类型数一条也数不出来、措辞一改老数据就散。加这一列把那句话从正文里拿出来。
--
-- 可空，不是漏写：旧行本来就没有类型，界面上那排胶囊也允许一枚都不点就提交。
-- 取值只在接口层按 src/lib/feedback-categories.ts 那六枚白名单校验，不建 CHECK——
-- 标签是产品措辞，以后加一枚类型不该再牵一次上生产的迁移。
--
-- 拼前缀那一版从没部署过，所以线上不该有带前缀的行；本地实测（10-18）也只有 1 行、不带前缀，
-- 这条 UPDATE 走下来命中 0 行。留着它是因为拼前缀的代码在工作树里真跑过（判据脚本提交过一次），
-- 谁的库里有那种行就该被拆干净，别留「类型」在正文里重复一遍。命中范围很窄：只对第一行正好是
-- 『类型：<六枚之一>』且后面还有正文的行动手，其余一个字不碰（拿三行对照实测过：拆一枚、两枚原样）。

ALTER TABLE "PlatformFeedback" ADD COLUMN     "category" TEXT;

WITH m AS (
  SELECT "id",
         -- 『类型：』是 3 个字，第 4 个字起就是标签。
         substr(split_part("content", E'\n', 1), 4) AS "head",
         substr("content", position(E'\n' in "content") + 1) AS "tail"
  FROM "PlatformFeedback"
  WHERE "content" LIKE '类型：%'
    AND position(E'\n' in "content") > 0
)
UPDATE "PlatformFeedback" p
SET "category" = m."head",
    "content"  = m."tail"
FROM m
WHERE p."id" = m."id"
  AND m."head" IN ('功能建议', '交互建议', '问题反馈', '卡顿缓慢', '夸一句', '其他');
