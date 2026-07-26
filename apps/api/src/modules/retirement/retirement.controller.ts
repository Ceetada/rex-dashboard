import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { contributeSchema } from '@evas/contracts';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { RetirementService } from './retirement.service';

@ApiTags('retirement')
@Controller('retirement')
export class RetirementController {
  constructor(private readonly retirement: RetirementService) {}

  @Get('savings')
  savings(@CurrentUser('sub') userId: string) {
    return this.retirement.getAccount(userId);
  }

  @Post('savings/contribute')
  @Idempotent()
  contribute(@CurrentUser('sub') userId: string, @ZodBody(contributeSchema) body: unknown) {
    return this.retirement.contribute(userId, body as never);
  }

  @Get('savings/contributions')
  contributions(
    @CurrentUser('sub') userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '20',
  ) {
    return this.retirement.listContributions(userId, {
      cursor,
      limit: Math.min(Number(limit) || 20, 100),
    });
  }

  @Get('pension')
  pension(@CurrentUser('sub') userId: string) {
    return this.retirement.getPension(userId);
  }
}
