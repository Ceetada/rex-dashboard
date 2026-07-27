import { randomBytes } from 'node:crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BuyAirtimeInput, BuyDataInput, SubscribeCableInput } from '@evas/contracts';
import { maskPhone } from '@evas/contracts';

import { AuditService } from '../../common/audit/audit.service';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProviderRegistry } from '../providers/provider.registry';
import type { CableAdapter, DeliveryOutcome, VtuAdapter } from '../providers/provider.types';
import { WalletService } from '../wallet/wallet.service';

function reference(): string {
  // Human-readable, unambiguous alphabet — no O/0 or I/1, because these get
  // read aloud to support agents over the phone.
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(8);
  return `EVS-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

/**
 * Airtime, data and cable purchases.
 *
 * The core problem this service solves is that paying for something and
 * receiving it are two separate, independently-failing events. The naive
 * implementation — debit, call provider, mark done — loses money in both
 * directions: it double-charges on retry, and it refuses refunds when the
 * provider times out after taking the request.
 *
 * The flow here is:
 *   1. Idempotency check      — a retry returns the original result, never a
 *                               second purchase.
 *   2. Debit + create order   — atomically, in one database transaction. If
 *                               either fails, neither happened.
 *   3. Call the provider      — outside the transaction, because a slow vendor
 *                               must not hold a database lock open.
 *   4. Settle                 — DELIVERED, or refund on a definite FAILED, or
 *                               park in REQUIRES_RECONCILIATION on UNKNOWN.
 *
 * Step 4's third branch is the one that matters. An UNKNOWN outcome is never
 * auto-refunded: the top-up may well have been delivered, and refunding it
 * would mean giving away airtime. It is requeried by a background job until
 * the provider gives a definite answer.
 */
@Injectable()
export class VtuService {
  private readonly logger = new Logger(VtuService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly registry: ProviderRegistry,
    private readonly encryption: EncryptionService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async buyAirtime(userId: string, input: BuyAirtimeInput) {
    const existing = await this.findByIdempotencyKey(input.idempotencyKey, userId);
    if (existing) return existing;

    const amount = BigInt(input.amountKobo);
    const { order, transaction } = await this.createPendingPurchase({
      userId,
      amountKobo: amount,
      serviceType: 'AIRTIME',
      network: input.network,
      recipient: input.phone,
      recipientMasked: maskPhone(input.phone),
      idempotencyKey: input.idempotencyKey,
      description: `${input.network} airtime for ${maskPhone(input.phone)}`,
      transactionType: 'AIRTIME_PURCHASE',
    });

    const { adapter, providerId } = await this.registry.resolve<VtuAdapter>('VTU');
    await this.prisma.serviceOrder.update({ where: { id: order.id }, data: { providerId } });

    const outcome = await this.attempt(adapter.slug, () =>
      adapter.purchaseAirtime({
        reference: order.reference,
        idempotencyKey: input.idempotencyKey,
        userId,
        network: input.network,
        phone: input.phone,
        amountKobo: input.amountKobo,
      }),
    );

    if (input.saveRecipient) {
      await this.saveRecipient(userId, {
        label: input.recipientLabel ?? maskPhone(input.phone),
        serviceType: 'AIRTIME',
        network: input.network,
        recipient: input.phone,
      });
    }

    return this.settle(order.id, transaction.id, userId, amount, outcome);
  }

  async buyData(userId: string, input: BuyDataInput) {
    const existing = await this.findByIdempotencyKey(input.idempotencyKey, userId);
    if (existing) return existing;

    const product = await this.prisma.serviceProduct.findFirst({
      where: { id: input.productId, serviceType: 'DATA', isActive: true },
    });
    if (!product) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'That data plan is no longer available' });
    }
    // The client sends a product id, never a price. Trusting a client-supplied
    // amount is how you get ₦1 purchases of ₦5,000 bundles.
    if (product.network !== input.network) {
      throw new BadRequestException({
        code: 'NETWORK_MISMATCH',
        message: 'That plan does not belong to the selected network',
      });
    }

    const { order, transaction } = await this.createPendingPurchase({
      userId,
      amountKobo: product.amount,
      serviceType: 'DATA',
      network: input.network,
      recipient: input.phone,
      recipientMasked: maskPhone(input.phone),
      idempotencyKey: input.idempotencyKey,
      description: `${product.name} for ${maskPhone(input.phone)}`,
      transactionType: 'DATA_PURCHASE',
      productId: product.id,
    });

    const { adapter, providerId } = await this.registry.resolve<VtuAdapter>('VTU');
    await this.prisma.serviceOrder.update({ where: { id: order.id }, data: { providerId } });

    const outcome = await this.attempt(adapter.slug, () =>
      adapter.purchaseData({
        reference: order.reference,
        idempotencyKey: input.idempotencyKey,
        userId,
        network: input.network,
        phone: input.phone,
        externalCode: product.externalCode,
        amountKobo: Number(product.amount),
      }),
    );

    if (input.saveRecipient) {
      await this.saveRecipient(userId, {
        label: input.recipientLabel ?? maskPhone(input.phone),
        serviceType: 'DATA',
        network: input.network,
        recipient: input.phone,
      });
    }

    return this.settle(order.id, transaction.id, userId, product.amount, outcome);
  }

  async subscribeCable(userId: string, input: SubscribeCableInput) {
    const existing = await this.findByIdempotencyKey(input.idempotencyKey, userId);
    if (existing) return existing;

    const product = await this.prisma.serviceProduct.findFirst({
      where: { id: input.productId, serviceType: 'CABLE', billerCode: input.biller, isActive: true },
    });
    if (!product) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'That package is no longer available' });
    }

    const { adapter, providerId } = await this.registry.resolve<CableAdapter>('CABLE');

    // Re-validate server-side. The customer name the client echoed back is for
    // the receipt only — it is not evidence the card is valid.
    const validation = await this.registry.execute(adapter.slug, () =>
      adapter.validateSmartcard(input.biller, input.smartcardNumber),
    );
    if (!validation.valid) {
      throw new BadRequestException({
        code: 'INVALID_SMARTCARD',
        message: validation.reason ?? 'We could not verify that smartcard number',
      });
    }

    const { order, transaction } = await this.createPendingPurchase({
      userId,
      amountKobo: product.amount,
      serviceType: 'CABLE',
      billerCode: input.biller,
      recipient: input.smartcardNumber,
      recipientMasked: `${input.smartcardNumber.slice(0, 4)}•••${input.smartcardNumber.slice(-3)}`,
      idempotencyKey: input.idempotencyKey,
      description: `${product.name} for ${validation.customerName ?? input.smartcardNumber}`,
      transactionType: 'CABLE_SUBSCRIPTION',
      productId: product.id,
      providerId,
    });

    const outcome = await this.attempt(adapter.slug, () =>
      adapter.subscribe({
        reference: order.reference,
        idempotencyKey: input.idempotencyKey,
        userId,
        biller: input.biller,
        smartcardNumber: input.smartcardNumber,
        externalCode: product.externalCode,
        amountKobo: Number(product.amount),
      }),
    );

    if (input.saveRecipient) {
      await this.saveRecipient(userId, {
        label: input.recipientLabel ?? validation.customerName ?? input.biller,
        serviceType: 'CABLE',
        billerCode: input.biller,
        recipient: input.smartcardNumber,
      });
    }

    return this.settle(order.id, transaction.id, userId, product.amount, outcome);
  }

  async validateSmartcard(biller: string, smartcardNumber: string) {
    const { adapter } = await this.registry.resolve<CableAdapter>('CABLE');
    const result = await this.registry.execute(adapter.slug, () =>
      adapter.validateSmartcard(biller, smartcardNumber),
    );
    if (!result.valid) {
      throw new BadRequestException({
        code: 'INVALID_SMARTCARD',
        message: result.reason ?? 'We could not verify that smartcard number',
      });
    }
    return {
      biller,
      smartcardNumber,
      customerName: result.customerName ?? '',
      currentPackage: result.currentPackage,
      dueDate: result.dueDate,
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async findByIdempotencyKey(key: string, userId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { idempotencyKey: key },
      include: { serviceOrder: true },
    });
    if (!transaction) return null;
    // A key belonging to another user is an attack, not a retry.
    if (transaction.userId !== userId) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_CONFLICT', message: 'Invalid request' });
    }
    this.logger.log(`Replaying idempotent request ${key} -> ${transaction.reference}`);
    return transaction.serviceOrder ? this.toDto(transaction.serviceOrder) : null;
  }

  /**
   * Creates the transaction, debits the wallet and creates the order — all or
   * nothing. Runs at Serializable isolation because the balance check and the
   * balance write must not be separable by another debit.
   */
  private async createPendingPurchase(input: {
    userId: string;
    amountKobo: bigint;
    serviceType: 'AIRTIME' | 'DATA' | 'CABLE';
    network?: BuyAirtimeInput['network'];
    billerCode?: string;
    recipient: string;
    recipientMasked: string;
    idempotencyKey: string;
    description: string;
    transactionType: 'AIRTIME_PURCHASE' | 'DATA_PURCHASE' | 'CABLE_SUBSCRIPTION';
    productId?: string;
    providerId?: string;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const transaction = await tx.transaction.create({
          data: {
            reference: reference(),
            userId: input.userId,
            type: input.transactionType,
            status: 'PROCESSING',
            channel: 'WALLET',
            amount: input.amountKobo,
            total: input.amountKobo,
            idempotencyKey: input.idempotencyKey,
            description: input.description,
            ...(input.providerId ? { providerId: input.providerId } : {}),
          },
        });

        await this.wallet.debit(tx, {
          userId: input.userId,
          amountKobo: input.amountKobo,
          narration: input.description,
          transactionId: transaction.id,
        });

        const order = await tx.serviceOrder.create({
          data: {
            reference: transaction.reference,
            userId: input.userId,
            transactionId: transaction.id,
            serviceType: input.serviceType,
            ...(input.network ? { network: input.network } : {}),
            ...(input.billerCode ? { billerCode: input.billerCode } : {}),
            ...(input.productId ? { productId: input.productId } : {}),
            ...(input.providerId ? { providerId: input.providerId } : {}),
            // The recipient is personal data: encrypted at rest, with a masked
            // copy kept in the clear purely so history lists render without
            // decrypting every row.
            recipientEncrypted: this.encryption.encrypt(input.recipient),
            recipientMasked: input.recipientMasked,
            amount: input.amountKobo,
            status: 'PROCESSING',
            attemptCount: 1,
            lastAttemptAt: new Date(),
          },
        });

        return { order, transaction };
      },
      { isolationLevel: 'Serializable', timeout: 15_000 },
    );
  }

  private async attempt(slug: string, call: () => Promise<DeliveryOutcome>): Promise<DeliveryOutcome> {
    try {
      return await this.registry.execute(slug, call);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider error';
      // A thrown error tells us nothing about whether the top-up landed, so we
      // must treat it as UNKNOWN rather than assuming failure and refunding.
      this.logger.error(`Provider ${slug} threw during delivery: ${message}`);
      return { status: 'UNKNOWN', reason: message };
    }
  }

  private async settle(
    orderId: string,
    transactionId: string,
    userId: string,
    amountKobo: bigint,
    outcome: DeliveryOutcome,
  ) {
    if (outcome.status === 'DELIVERED') {
      const order = await this.prisma.$transaction(async (tx) => {
        await tx.transaction.update({
          where: { id: transactionId },
          data: {
            status: 'SUCCESSFUL',
            completedAt: new Date(),
            providerReference: outcome.providerReference,
            providerResponse: outcome.raw as never,
          },
        });
        return tx.serviceOrder.update({
          where: { id: orderId },
          data: {
            status: 'DELIVERED',
            deliveredAt: new Date(),
            providerReference: outcome.providerReference,
            providerResponse: outcome.raw as never,
          },
        });
      });

      await this.notifications.send(userId, {
        category: 'SERVICE',
        title: 'Purchase successful',
        body: order.recipientMasked
          ? `Your purchase for ${order.recipientMasked} was delivered.`
          : 'Your purchase was delivered.',
        actionUrl: `/services/history/${order.reference}`,
        data: { reference: order.reference, amountKobo: Number(amountKobo) },
      });

      return this.toDto(order);
    }

    if (outcome.status === 'FAILED') {
      // A definite rejection. The money never left the provider's side, so we
      // return it immediately — the user should not wait on a job for this.
      const order = await this.prisma.$transaction(async (tx) => {
        await this.wallet.refund(tx, {
          userId,
          amountKobo,
          originalTransactionId: transactionId,
          reason: outcome.reason,
        });
        await tx.transaction.update({
          where: { id: transactionId },
          data: { status: 'FAILED', failureReason: outcome.reason },
        });
        return tx.serviceOrder.update({
          where: { id: orderId },
          data: { status: 'REFUNDED', failureReason: outcome.reason },
        });
      });

      await this.notifications.send(userId, {
        category: 'SERVICE',
        title: 'Purchase failed — refunded',
        body: `We could not complete your purchase, so we have returned the money to your wallet.`,
        actionUrl: `/services/history/${order.reference}`,
        data: { reference: order.reference, reason: outcome.reason },
      });

      return this.toDto(order);
    }

    // UNKNOWN. Hold the line: do not refund, do not confirm. The reconciliation
    // job requeries this order until the provider commits to an answer.
    const order = await this.prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: transactionId },
        data: {
          status: 'REQUIRES_RECONCILIATION',
          failureReason: outcome.reason,
          ...(outcome.providerReference ? { providerReference: outcome.providerReference } : {}),
        },
      });
      return tx.serviceOrder.update({
        where: { id: orderId },
        data: {
          status: 'REQUIRES_RECONCILIATION',
          failureReason: outcome.reason,
          ...(outcome.providerReference ? { providerReference: outcome.providerReference } : {}),
        },
      });
    });

    await this.audit.record({
      actorId: null,
      actorType: 'SYSTEM',
      action: 'service_order.requires_reconciliation',
      resource: 'ServiceOrder',
      resourceId: order.id,
      outcome: 'FAILURE',
      reason: outcome.reason,
    });

    await this.notifications.send(userId, {
      category: 'SERVICE',
      title: 'Purchase is being confirmed',
      body: 'We are confirming this purchase with the network. You will hear from us shortly, and you will be refunded automatically if it did not go through.',
      actionUrl: `/services/history/${order.reference}`,
      data: { reference: order.reference },
    });

    return this.toDto(order);
  }

  private async saveRecipient(
    userId: string,
    input: { label: string; serviceType: 'AIRTIME' | 'DATA' | 'CABLE'; network?: string; billerCode?: string; recipient: string },
  ) {
    const blindIndex = this.encryption.blindIndex(input.recipient);
    const masked =
      input.serviceType === 'CABLE'
        ? `${input.recipient.slice(0, 4)}•••${input.recipient.slice(-3)}`
        : maskPhone(input.recipient);

    // Upsert so saving the same number twice updates the label and usage
    // counters instead of cluttering the list with duplicates.
    await this.prisma.savedRecipient.upsert({
      where: {
        userId_serviceType_recipientBlindIndex: {
          userId,
          serviceType: input.serviceType,
          recipientBlindIndex: blindIndex,
        },
      },
      create: {
        userId,
        label: input.label,
        serviceType: input.serviceType,
        ...(input.network ? { network: input.network as never } : {}),
        ...(input.billerCode ? { billerCode: input.billerCode } : {}),
        recipientEncrypted: this.encryption.encrypt(input.recipient),
        recipientMasked: masked,
        recipientBlindIndex: blindIndex,
        lastUsedAt: new Date(),
        useCount: 1,
      },
      update: { lastUsedAt: new Date(), useCount: { increment: 1 } },
    });
  }

  private toDto(order: {
    id: string;
    reference: string;
    serviceType: string;
    network: string | null;
    billerCode: string | null;
    recipientMasked: string;
    amount: bigint;
    status: string;
    failureReason: string | null;
    createdAt: Date;
    deliveredAt: Date | null;
  }) {
    return {
      id: order.id,
      reference: order.reference,
      serviceType: order.serviceType,
      network: order.network,
      billerCode: order.billerCode,
      recipientMasked: order.recipientMasked,
      productName: null,
      amountKobo: Number(order.amount),
      status: order.status,
      failureReason: order.failureReason,
      createdAt: order.createdAt.toISOString(),
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
    };
  }
}
