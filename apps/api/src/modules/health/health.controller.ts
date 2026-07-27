import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { subscribeToPlanSchema } from '@evas/contracts';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health-plans')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Public so the plan catalogue can be rendered and indexed before sign-up. */
  @Public()
  @Get()
  listPlans() {
    return this.health.listPlans();
  }

  @Public()
  @Get('plans/:slug')
  getPlan(@Param('slug') slug: string) {
    return this.health.getPlan(slug);
  }

  @Public()
  @Get('hospitals')
  hospitals(
    @Query('stateCode') stateCode?: string,
    @Query('city') city?: string,
    @Query('hmoProviderId') hmoProviderId?: string,
  ) {
    return this.health.findHospitals({ stateCode, city, hmoProviderId });
  }

  @Get('subscriptions')
  subscriptions(@CurrentUser('sub') userId: string) {
    return this.health.listSubscriptions(userId);
  }

  @Post('subscriptions')
  subscribe(@CurrentUser('sub') userId: string, @ZodBody(subscribeToPlanSchema) body: unknown) {
    return this.health.subscribe(userId, body as never);
  }

  @Delete('subscriptions/:id')
  cancel(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body('reason') reason = 'Not specified',
  ) {
    return this.health.cancel(userId, id, reason);
  }
}
