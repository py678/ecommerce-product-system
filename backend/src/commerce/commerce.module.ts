import {
  Module,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class CommerceAuthorityService {
  constructor(private readonly db: DatabaseService) {}
  async requireWriter() {
    const config = await this.db.commerceConfig.findUnique({
      where: { id: 1 },
    });
    if (!config || config.writeRole === 'REPLICA')
      throw new ServiceUnavailableException(
        '当前数据库是只读副本，请使用主服务操作',
      );
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [CommerceAuthorityService],
  exports: [CommerceAuthorityService],
})
export class CommerceModule {}
