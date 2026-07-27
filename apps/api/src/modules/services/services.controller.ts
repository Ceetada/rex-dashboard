import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  buyAirtimeSchema,
  buyDataSchema,
  subscribeCableSchema,
  validateSmartcardSchema,
} from '@evas/contracts';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { VtuService } from './vtu.service';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(
    private readonly vtu: VtuService,
    private readonly prisma: PrismaService,
  ) {}

  /** Catalogue. Cached hard at the edge — these change daily at most. */
  @Get('products')
  async products(
    @Query('serviceType') serviceType: string,
    @Query('network') network?: string,
    @Query('biller') biller?: string,
  ) {
    const products = await this.prisma.serviceProduct.findMany({
      where: {
        serviceType: serviceType as never,
        isActive: true,
        ...(network ? { network: network as never } : {}),
        ...(biller ? { billerCode: biller } : {}),
      },
      orderBy: [{ displayOrder: 'asc' }, { amount: 'asc' }],
    });

    return products.map((p) => ({
      id: p.id,
      serviceType: p.serviceType,
      network: p.network,
      billerCode: p.billerCode,
      name: p.name,
      description: p.description,
      amountKobo: Number(p.amount),
      validityDays: p.validityDays,
      // costPrice is deliberately not exposed — our margin is not the user's
      // business, and leaking it invites arbitrage.
    }));
  }

  /**
   * Purchases are throttled tightly. A legitimate user does not buy airtime
   * twenty times a minute; a compromised account being drained does.
   */
  @Post('airtime')
  @Idempotent()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async buyAirtime(@CurrentUser('sub') userId: string, @ZodBody(buyAirtimeSchema) body: unknown) {
    return this.vtu.buyAirtime(userId, body as never);
  }

  @Post('data')
  @Idempotent()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async buyData(@CurrentUser('sub') userId: string, @ZodBody(buyDataSchema) body: unknown) {
    return this.vtu.buyData(userId, body as never);
  }

  @Post('cable/validate')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async validateSmartcard(@ZodBody(validateSmartcardSchema) body: unknown) {
    const { biller, smartcardNumber } = body as { biller: string; smartcardNumber: string };
    return this.vtu.validateSmartcard(biller, smartcardNumber);
  }

  @Post('cable')
  @Idempotent()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async subscribeCable(@CurrentUser('sub') userId: string, @ZodBody(subscribeCableSchema) body: unknown) {
    return this.vtu.subscribeCable(userId, body as never);
  }

  @Get('recipients')
  async recipients(@CurrentUser('sub') userId: string, @Query('serviceType') serviceType?: string) {
    const recipients = await this.prisma.savedRecipient.findMany({
      where: { userId, ...(serviceType ? { serviceType: serviceType as never } : {}) },
      orderBy: [{ isFavourite: 'desc' }, { lastUsedAt: 'desc' }],
      take: 50,
    });
    return recipients.map((r) => ({
      id: r.id,
      label: r.label,
      serviceType: r.serviceType,
      network: r.network,
      billerCode: r.billerCode,
      // The encrypted value never leaves the server; purchases reference the
      // saved recipient by id and the server decrypts internally.
      recipientMasked: r.recipientMasked,
      isFavourite: r.isFavourite,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      useCount: r.useCount,
    }));
  }

  @Get('orders')
  async orders(
    @CurrentUser('sub') userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '20',
    @Query('serviceType') serviceType?: string,
  ) {
    const take = Math.min(Number(limit) || 20, 100);
    const orders = await this.prisma.serviceOrder.findMany({
      where: { userId, ...(serviceType ? { serviceType: serviceType as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { product: { select: { name: true } } },
    });

    const hasMore = orders.length > take;
    const page = hasMore ? orders.slice(0, take) : orders;

    return {
      data: page.map((o) => ({
        id: o.id,
        reference: o.reference,
        serviceType: o.serviceType,
        network: o.network,
        billerCode: o.billerCode,
        recipientMasked: o.recipientMasked,
        productName: o.product?.name ?? null,
        amountKobo: Number(o.amount),
        status: o.status,
        failureReason: o.failureReason,
        createdAt: o.createdAt.toISOString(),
        deliveredAt: o.deliveredAt?.toISOString() ?? null,
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }
}
