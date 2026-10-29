import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // A placeholder allows validate/generate before local credentials are configured.
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://configure:configure@localhost:5432/silk_shop',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
