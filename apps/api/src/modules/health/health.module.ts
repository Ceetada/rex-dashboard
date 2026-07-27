import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [WalletModule, NotificationsModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
