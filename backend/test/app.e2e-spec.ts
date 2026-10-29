import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './../dist/app.module.js';
import { DatabaseService } from './../dist/database/database.service.js';

describe('Application bootstrap (e2e, requires migrated database)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('connects the Nest database provider to PostgreSQL', async () => {
    const db = app.get(DatabaseService);
    const result = await db.$queryRaw<
      Array<{ value: number }>
    >`SELECT 1 AS value`;
    expect(result).toEqual([{ value: 1 }]);
  });

  afterEach(async () => {
    await app.close();
  });
});
