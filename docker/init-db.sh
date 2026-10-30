#!/bin/sh
set -eu
# psql quotes the password as a SQL literal; never interpolate it into SQL text.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$APP_PASSWORD" --set=ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE silk_shop_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER SCHEMA public OWNER TO silk_shop_app;
GRANT CONNECT ON DATABASE silk_shop TO silk_shop_app;
SQL
