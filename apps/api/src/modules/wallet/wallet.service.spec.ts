import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WalletService } from './wallet.service';

/**
 * These tests exist to pin down the two behaviours that cost real money if they
 * regress: a debit must never take a wallet negative, and a refund must never
 * be applied twice.
 *
 * The row lock itself is verified in the integration suite against a real
 * Postgres — a mock cannot demonstrate that FOR UPDATE serialises anything.
 * What is asserted here is that the service *asks* for the lock, and that its
 * decision logic is correct given what the lock returns.
 */
describe('WalletService', () => {
  let service: WalletService;
  let tx: {
    $queryRaw: ReturnType<typeof vi.fn>;
    wallet: { update: ReturnType<typeof vi.fn> };
    ledgerEntry: { create: ReturnType<typeof vi.fn> };
    transaction: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    service = new WalletService({} as never);
    tx = {
      $queryRaw: vi.fn(),
      wallet: { update: vi.fn().mockResolvedValue({}) },
      ledgerEntry: { create: vi.fn().mockResolvedValue({}) },
      transaction: {
        findUnique: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'rev-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
  });

  /**
   * Keys must match the columns the service actually SELECTs. They were
   * snake_case here originally, which is how a broken raw query passed the unit
   * suite for so long — the mock simply agreed with the bug. The integration
   * suite is what caught it, and this shape now mirrors the real result set.
   */
  const wallet = (balance: bigint, overrides: Record<string, unknown> = {}) => [
    { id: 'w1', balance, ledgerBalance: balance, isFrozen: false, ...overrides },
  ];

  describe('debit', () => {
    it('takes a row lock before reading the balance', async () => {
      tx.$queryRaw.mockResolvedValue(wallet(100_000n));
      await service.debit(tx as never, {
        userId: 'u1', amountKobo: 50_000n, narration: 'Airtime', transactionId: 't1',
      });

      // Reading the balance without FOR UPDATE is the double-spend bug.
      const sql = tx.$queryRaw.mock.calls[0]![0].join('');
      expect(sql).toContain('FOR UPDATE');
    });

    it('writes the balance and the explaining ledger entry together', async () => {
      tx.$queryRaw.mockResolvedValue(wallet(100_000n));
      const balanceAfter = await service.debit(tx as never, {
        userId: 'u1', amountKobo: 30_000n, narration: 'Data bundle', transactionId: 't1',
      });

      expect(balanceAfter).toBe(70_000n);
      expect(tx.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ balance: 70_000n }) }),
      );
      expect(tx.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ direction: 'DEBIT', amount: 30_000n, balanceAfter: 70_000n }),
        }),
      );
    });

    it('refuses to overdraw and reports the shortfall', async () => {
      tx.$queryRaw.mockResolvedValue(wallet(20_000n));
      await expect(
        service.debit(tx as never, {
          userId: 'u1', amountKobo: 50_000n, narration: 'Airtime', transactionId: 't1',
        }),
      ).rejects.toThrow(ConflictException);
      expect(tx.wallet.update).not.toHaveBeenCalled();
    });

    it('rejects a debit that exactly exceeds the balance by one kobo', async () => {
      // Off-by-one at the boundary is where integer money bugs actually live.
      tx.$queryRaw.mockResolvedValue(wallet(50_000n));
      await expect(
        service.debit(tx as never, {
          userId: 'u1', amountKobo: 50_001n, narration: 'x', transactionId: 't1',
        }),
      ).rejects.toThrow(ConflictException);

      tx.$queryRaw.mockResolvedValue(wallet(50_000n));
      await expect(
        service.debit(tx as never, {
          userId: 'u1', amountKobo: 50_000n, narration: 'x', transactionId: 't1',
        }),
      ).resolves.toBe(0n);
    });

    it('blocks debits from a frozen wallet', async () => {
      tx.$queryRaw.mockResolvedValue(wallet(100_000n, { isFrozen: true }));
      await expect(
        service.debit(tx as never, {
          userId: 'u1', amountKobo: 1_000n, narration: 'x', transactionId: 't1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it.each([0n, -100n])('rejects a non-positive amount (%s)', async (amount) => {
      await expect(
        service.debit(tx as never, {
          userId: 'u1', amountKobo: amount, narration: 'x', transactionId: 't1',
        }),
      ).rejects.toThrow();
    });
  });

  describe('credit', () => {
    it('still accepts money into a frozen wallet when allowFrozen is set', async () => {
      // Freezing stops money leaving, not refunds we owe the user.
      tx.$queryRaw.mockResolvedValue(wallet(0n, { isFrozen: true }));
      await expect(
        service.credit(tx as never, {
          userId: 'u1', amountKobo: 5_000n, narration: 'Refund', transactionId: 't1', allowFrozen: true,
        }),
      ).resolves.toBe(5_000n);
    });

    it('blocks an ordinary credit into a frozen wallet', async () => {
      tx.$queryRaw.mockResolvedValue(wallet(0n, { isFrozen: true }));
      await expect(
        service.credit(tx as never, {
          userId: 'u1', amountKobo: 5_000n, narration: 'Funding', transactionId: 't1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('refund', () => {
    it('is idempotent — a second refund of the same transaction is a no-op', async () => {
      // The reconciliation job can genuinely try this twice; paying out twice
      // is worse than not paying out at all.
      tx.transaction.findUnique.mockResolvedValue({
        id: 't1', reference: 'EVS-1', reversedAt: new Date(),
      });

      await service.refund(tx as never, {
        userId: 'u1', amountKobo: 10_000n, originalTransactionId: 't1', reason: 'Provider failed',
      });

      expect(tx.transaction.create).not.toHaveBeenCalled();
      expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    });

    it('records a compensating credit rather than editing the original debit', async () => {
      tx.transaction.findUnique.mockResolvedValue({ id: 't1', reference: 'EVS-1', reversedAt: null });
      tx.$queryRaw.mockResolvedValue(wallet(0n));

      await service.refund(tx as never, {
        userId: 'u1', amountKobo: 10_000n, originalTransactionId: 't1', reason: 'Provider failed',
      });

      // The statement must show both the charge and the refund.
      expect(tx.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ direction: 'CREDIT', amount: 10_000n }) }),
      );
      expect(tx.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REVERSED' }) }),
      );
    });
  });
});
