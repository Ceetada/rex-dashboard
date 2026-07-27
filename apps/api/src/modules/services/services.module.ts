import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { ReconciliationJob } from './reconciliation.job';
import { ServicesController } from './services.controller';
import { VtuService } from './vtu.service';

@Module({
  imports: [WalletModule, NotificationsModule],
  controllers: [ServicesController],
  providers: [VtuService, ReconciliationJob],
  exports: [VtuService],
})
export class ServicesModule {}
