-- 等保二级 R9：应用连接账号降权（对应高风险第 6 条"应用以数据库超级用户连接"）。
--
-- 用法（以管理角色身份执行；角色名与口令都走变量，脚本里不出现任何口令字面量）：
--   docker compose exec -T postgres psql -U <管理员> -d <库名> \
--     -v admin_role=<管理员角色> -v app_password="$APP_DB_PASSWORD" -f prisma/roles/app-role.sql
--   注意是 "$APP_DB_PASSWORD" 而不是 "'$APP_DB_PASSWORD'"：`:'name'` 这形式自己会加引号，
--   再套一层会得到带引号的口令，角色建出来能登录失败（我在这儿踩过一次）。
--
-- 之后运行期用 vitransfer_app 连库；建表/改表的迁移仍用管理角色，而且只在部署那一次用
-- （见 docker-entrypoint.sh 里的 MIGRATION_DATABASE_URL）。本脚本不碰任何数据。
--
-- 撤销（本地库实测过：直接 DROP ROLE 会因依赖失败，必须先 DROP OWNED BY）：
--   psql ... -c "DROP OWNED BY vitransfer_app;" -c "DROP ROLE vitransfer_app;"

CREATE ROLE vitransfer_app LOGIN PASSWORD :'app_password';

-- 不给 superuser / createdb / createrole，也不给 bypassrls。
ALTER ROLE vitransfer_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

GRANT USAGE ON SCHEMA public TO vitransfer_app;

-- 现有对象：只给数据读写，不给 DDL。
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vitransfer_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vitransfer_app;

-- 以后由管理角色新建的表/序列自动带上同一套权限，否则每次迁移都要补一遍授权，
-- 漏一次就是生产报错。
ALTER DEFAULT PRIVILEGES FOR ROLE :admin_role IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vitransfer_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :admin_role IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO vitransfer_app;
