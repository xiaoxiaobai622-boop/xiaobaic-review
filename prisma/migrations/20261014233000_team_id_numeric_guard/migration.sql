-- 团队 ID 形状闸门（10-14 他点单「换吧，全部都换」之后补的防线）。
--
-- 两件事：
--  1) 把库里任何不合形状的 Team.id 换成空出的 6 位号。旧形状从两条路长出来：历史迁移
--     （20260816010000_add_teams）里写死过一枚 `team_default`，Prisma 也曾经给 Team.id
--     挂 @default(cuid())。前者只在「Team 表之前就已经有 ADMIN 账号」的老库升级到这一版
--     时落行——线上与本地当年正是这么长出来的；全新库回放那条 INSERT 一行都不落（拿一枚
--     空库整条跑过 118 条迁移实测：Team 0 枚）。
--  2) 给 Team.id 上 CHECK，之后任何旧形状的号都进不来，裸 SQL 也一样。
--
-- 已经整批改过号的库（本地与线上都实测过：7 枚全 6 位）走 1 时命中 0 行，等于只加 CHECK。
--
-- 顺序是有讲究的：先动 Team.id，引用它的 10 条外键全是 ON UPDATE CASCADE（线上
-- pg_constraint 逐条读过），子表的 teamId 由数据库自己带走；反过来先改子表会当场撞外键，
-- 因为新号此刻还没出现在 Team 里。只有 TeamActivationCard.redeemedByTeamId 没有外键
-- （全库带 team 字样的列都列过，就它一条漏在约束外），单独补。
--
-- 库里既有旧号、又有对象路径指着它时，这枚迁移主动抛错停下：对象存储的键 SQL 搬不动，
-- 只改库会把媒体全打成坏文件。那种库是真实部署，得先跑 scripts/migrate-team-ids*.mts
-- （--move 搬对象 → --apply 改库 → --verify 逐条核 → 满一天再 --prune 删旧）。

DO $$
DECLARE
  legacy bigint;
  referenced bigint := 0;
  r record;
  n bigint;
BEGIN
  SELECT count(*) INTO legacy FROM "Team" WHERE id !~ '^[1-9]\d{5}$';
  IF legacy = 0 THEN
    RETURN;
  END IF;

  -- 空出的号：100000-999999，避开已有号，也避开纯数字的团队标识与分享键——slug 那一路
  -- 发的也是数字，撞成同一串就等于界面上两枚不同的号长得一模一样。
  CREATE TEMP TABLE team_legacy_id_map ON COMMIT DROP AS
  SELECT need.old_id AS old_id, pool.new_id AS new_id
  FROM (
    SELECT id AS old_id, row_number() OVER (ORDER BY id) AS rn
    FROM "Team" WHERE id !~ '^[1-9]\d{5}$'
  ) need
  JOIN (
    SELECT free.new_id, row_number() OVER (ORDER BY free.new_id) AS rn
    FROM (
      SELECT g::text AS new_id FROM generate_series(100000, 999999) g
      EXCEPT (SELECT id FROM "Team")
      EXCEPT (SELECT slug FROM "Team" WHERE slug ~ '^[0-9]+$')
      EXCEPT (SELECT "shareKey" FROM "Team" WHERE "shareKey" ~ '^[0-9]+$')
    ) free
  ) pool ON pool.rn = need.rn;

  IF (SELECT count(*) FROM team_legacy_id_map) < legacy THEN
    RAISE EXCEPTION '号池装不下 % 枚旧团队号（100000-999999 已被占满），先清号再迁移', legacy;
  END IF;

  -- 有对象路径落在旧号目录下 ⇒ 这是真部署，不是刚建出来的库：停下让人先搬对象。
  FOR r IN
    SELECT table_name AS tbl, column_name AS col
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying')
      AND table_name NOT LIKE 'pg\_%' AND table_name <> '_prisma_migrations'
  LOOP
    BEGIN
      EXECUTE format(
        'SELECT count(*) FROM %I.%I x JOIN team_legacy_id_map m'
        || ' ON x.%I::text LIKE %L || m.old_id || %L', r.tbl, r.col, r.col, 'teams/', '/%')
        INTO n;
    EXCEPTION WHEN others THEN
      n := 0;
    END;
    referenced := referenced + n;
  END LOOP;
  IF referenced > 0 THEN
    RAISE EXCEPTION '库里还有 % 个对象路径落在旧团队号下：那是真部署，SQL 搬不动对象存储。先跑 scripts/migrate-team-ids*.mts --move 搬对象，再让这枚迁移过', referenced;
  END IF;

  -- 没外键那一条自己补（顺序在 Team 改名之前，因为它不受 cascade 带走）。
  UPDATE "TeamActivationCard" c SET "redeemedByTeamId" = m.new_id
  FROM team_legacy_id_map m WHERE c."redeemedByTeamId" = m.old_id;

  UPDATE "Team" t SET id = m.new_id FROM team_legacy_id_map m WHERE t.id = m.old_id;

  IF (SELECT count(*) FROM "Team" WHERE id !~ '^[1-9]\d{5}$') > 0 THEN
    RAISE EXCEPTION '改完还剩不合形状的团队号，别上 CHECK';
  END IF;
END $$;

-- ALTER TABLE ADD CONSTRAINT 写在 DO 里就没法跟着 RETURN 一起跳过，所以单独一句。
-- 已经合规的库走到这里直接加上，等于一道硬闸。
ALTER TABLE "Team" ADD CONSTRAINT "Team_id_numeric_shape" CHECK ("id" ~ '^[1-9]\d{5}$');
