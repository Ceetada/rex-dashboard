import { Module } from '@nestjs/common';

import { WalletModule } from '../wallet/wallet.module';
import { RetirementController } from './retirement.controller';
import { RetirementService } from './retirement.service';

@Module({
  imports: [WalletModule],
  controllers: [RetirementController],
  providers: [RetirementService],
  exports: [RetirementService],
})
export class RetirementModule {}
