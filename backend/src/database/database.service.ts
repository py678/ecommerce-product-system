import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is required. Configure backend/.env before starting.',
      );
    }
    // Respect the configured schema, including isolated integration-test namespaces.
    const schema =
      new URL(connectionString).searchParams.get('schema') ?? 'public';
    if (!/^[a-z_][a-z0-9_]*$/.test(schema))
      throw new Error('Invalid database schema');
    super({
      adapter: new PrismaPg(
        { connectionString, options: '-c search_path=' + schema },
        { schema },
      ),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
