/**
 * Demo data.
 *
 * Creates one fully-onboarded user with a plausible history, so the app can be
 * looked at without clicking through every flow first. Kept separate from
 * seed.ts because that one is reference data and safe to run in production —
 * this one is emphatically not.
 *
 *   pnpm --filter @evas/api prisma:seed:demo
 *
 * Login: chidinma@example.com / Correct-Horse7-Battery
 * The first sign-in from a new device still issues a real OTP challenge; the
 * code is printed to the API log outside production.
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createCipheriv, createHmac, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

if (process.env.NODE_ENV === 'production') {
  throw new Error('seed-demo.ts must never run in production');
}

/**
 * Mirrors EncryptionService so seeded rows are readable by the running API.
 * Kept deliberately small rather than importing the Nest service, which would
 * drag the whole DI container into a script.
 */
function makeCrypto() {
  const raw = process.env.ENCRYPTION_KEYS;
  const blindKeyRaw = process.env.BLIND_INDEX_KEY;
  if (!raw || !blindKeyRaw) {
    throw new Error('ENCRYPTION_KEYS and BLIND_INDEX_KEY must be set (load apps/api/.env)');
  }
  const [version, material] = raw.split(',')[0]!.split(':');
  const key = Buffer.from(material!.trim(), 'base64');
  const blindKey = Buffer.from(blindKeyRaw, 'base64');

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Buffer.concat([
        Buffer.from([Number(version)]),
        iv,
        cipher.getAuthTag(),
        ciphertext,
      ]).toString('base64');
    },
    blindIndex(value: string): string {
      return createHmac('sha256', blindKey).update(value.trim().toLowerCase()).digest('base64url');
    },
  };
}

const NAIRA = (amount: number) => BigInt(Math.round(amount * 100));

async function main() {
  const crypto = makeCrypto();
  const email = 'chidinma@example.com';

  console.log('Seeding demo data…');

  // Idempotent: wipe and recreate, so re-running gives a known state.
  await prisma.user.deleteMany({ where: { email } });

  const passwordHash = await argon2.hash('Correct-Horse7-Battery', {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const user = await prisma.user.create({
    data: {
      email,
      phone: '+2348031234567',
      passwordHash,
      status: 'ACTIVE',
      kycTier: 'TIER_2',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      profile: {
        create: {
          firstName: 'Chidinma',
          lastName: 'Okafor',
          dateOfBirth: new Date('1995-03-14'),
          gender: 'FEMALE',
          addressLine1: '14 Adeola Odeku Street',
          city: 'Victoria Island',
          stateCode: 'LA',
          // Encrypted, with a blind index — exactly as the API would write it.
          bvnEncrypted: crypto.encrypt('22134567890'),
          bvnBlindIndex: crypto.blindIndex('22134567890'),
        },
      },
      wallet: { create: { balance: NAIRA(124_500), ledgerBalance: NAIRA(122_500) } },
      notificationPrefs: { create: {} },
    },
    include: { wallet: true },
  });

  const userRole = await prisma.role.findUnique({ where: { name: 'user' } });
  if (userRole) {
    await prisma.userRole.create({ data: { userId: user.id, roleId: userRole.id } });
  }

  // ── Transaction history ──────────────────────────────────────────────────
  const history: Array<[string, any, any, number, string, number]> = [
    ['EVS-8F3K2M9Q', 'AIRTIME_PURCHASE', 'SUCCESSFUL', 500, 'MTN airtime for 0803•••4567', 2],
    ['EVS-2M9QK4LP', 'WALLET_FUNDING', 'SUCCESSFUL', 50_000, 'Wallet funding — card', 26],
    // One order deliberately left in limbo, so the "Confirming" state is
    // visible on the dashboard rather than only described in the docs.
    ['EVS-K4LP7Q2M', 'CABLE_SUBSCRIPTION', 'REQUIRES_RECONCILIATION', 19_000, 'DStv Compact for 1234•••789', 72],
    ['EVS-7Q2MX9F3', 'DATA_PURCHASE', 'SUCCESSFUL', 3_500, '10GB Monthly for 0803•••4567', 120],
    ['EVS-X9F3K2M9', 'HEALTH_PREMIUM', 'SUCCESSFUL', 12_000, 'Family HMO Plan — monthly premium', 168],
    ['EVS-M9QK4LP7', 'RETIREMENT_CONTRIBUTION', 'SUCCESSFUL', 50_000, 'Retirement contribution', 200],
  ];

  for (const [reference, type, status, naira, description, hoursAgo] of history) {
    const at = new Date(Date.now() - hoursAgo * 3_600_000);
    const transaction = await prisma.transaction.create({
      data: {
        reference,
        userId: user.id,
        type,
        status,
        channel: type === 'WALLET_FUNDING' ? 'CARD' : 'WALLET',
        amount: NAIRA(naira),
        total: NAIRA(naira),
        description,
        initiatedAt: at,
        createdAt: at,
        completedAt: status === 'SUCCESSFUL' ? at : null,
      },
    });

    if (status === 'SUCCESSFUL') {
      await prisma.ledgerEntry.create({
        data: {
          walletId: user.wallet!.id,
          transactionId: transaction.id,
          direction: type === 'WALLET_FUNDING' ? 'CREDIT' : 'DEBIT',
          amount: NAIRA(naira),
          balanceAfter: NAIRA(124_500),
          narration: description,
          createdAt: at,
        },
      });
    }
  }

  // ── Health cover ─────────────────────────────────────────────────────────
  const familyPlan = await prisma.healthPlan.findUnique({ where: { slug: 'family-hmo' } });
  if (familyPlan) {
    const renewal = new Date();
    renewal.setDate(renewal.getDate() + 24); // inside 30 days, so the UI escalates it

    await prisma.healthSubscription.create({
      data: {
        userId: user.id,
        planId: familyPlan.id,
        status: 'ACTIVE',
        memberNumberEncrypted: crypto.encrypt('EVS-HMO-994821'),
        startDate: new Date(Date.now() - 340 * 86_400_000),
        renewalDate: renewal,
        premiumAmount: familyPlan.premiumAmount,
        billingCycle: 'MONTHLY',
        dependants: {
          create: [
            { firstName: 'Ada', lastName: 'Okafor', dateOfBirth: new Date('2016-07-02'), relationship: 'CHILD', gender: 'FEMALE' },
            { firstName: 'Chidi', lastName: 'Okafor', dateOfBirth: new Date('2019-11-18'), relationship: 'CHILD', gender: 'MALE' },
            { firstName: 'Ngozi', lastName: 'Okafor', dateOfBirth: new Date('1992-01-09'), relationship: 'SPOUSE', gender: 'FEMALE' },
          ],
        },
      },
    });
  }

  // ── Retirement savings ───────────────────────────────────────────────────
  const retirement = await prisma.retirementAccount.create({
    data: {
      userId: user.id,
      accountNumber: 'EVS-RSV-0004821',
      riskProfile: 'BALANCED',
      balance: NAIRA(1_240_000),
      totalContributed: NAIRA(1_100_000),
      totalGrowth: NAIRA(140_000),
      targetAmount: NAIRA(10_000_000),
      targetDate: new Date('2041-01-01'),
      autoDebitEnabled: true,
      autoDebitAmount: NAIRA(50_000),
      autoDebitDayOfMonth: 28,
      holdings: {
        create: [
          { assetClass: 'FIXED_INCOME', instrument: 'FGN Bond 2031', units: 620, unitCost: 1000, currentValue: NAIRA(620_000), allocationPct: 50 },
          { assetClass: 'MONEY_MARKET', instrument: 'Money Market Fund', units: 372, unitCost: 1000, currentValue: NAIRA(372_000), allocationPct: 30 },
          { assetClass: 'EQUITY', instrument: 'NGX 30 Equity Fund', units: 248, unitCost: 1000, currentValue: NAIRA(248_000), allocationPct: 20 },
        ],
      },
    },
  });

  // 18 months of valuations, so the chart has a real shape rather than a line.
  for (let monthsAgo = 17; monthsAgo >= 0; monthsAgo -= 1) {
    const asOf = new Date();
    asOf.setMonth(asOf.getMonth() - monthsAgo);
    asOf.setDate(1);
    asOf.setHours(0, 0, 0, 0);

    const elapsed = 18 - monthsAgo;
    const contributed = 50_000 * elapsed;
    // Compounding at roughly 1.1% a month, so growth accelerates visibly.
    const growth = Math.round(contributed * 0.011 * elapsed * 0.6);

    await prisma.accountValuation.create({
      data: {
        accountId: retirement.id,
        asOfDate: asOf,
        contributed: NAIRA(contributed),
        growth: NAIRA(growth),
        balance: NAIRA(contributed + growth),
      },
    });

    await prisma.retirementContribution.create({
      data: {
        accountId: retirement.id,
        amount: NAIRA(50_000),
        source: monthsAgo % 6 === 0 ? 'BONUS' : 'AUTO_DEBIT',
        periodMonth: asOf,
        createdAt: asOf,
      },
    });
  }

  // ── Pension ──────────────────────────────────────────────────────────────
  const pfa = await prisma.pensionFundAdmin.upsert({
    where: { code: 'STANBIC' },
    create: { name: 'Stanbic IBTC Pension Managers', code: 'STANBIC', licenceNo: 'PENCOM/PFA/001' },
    update: {},
  });

  await prisma.pensionAccount.create({
    data: {
      userId: user.id,
      pfaId: pfa.id,
      rsaNumberEncrypted: crypto.encrypt('PEN100234821'),
      rsaBlindIndex: crypto.blindIndex('PEN100234821'),
      employerName: 'Paystack Payments Limited',
      employmentStartDate: new Date('2019-02-01'),
      currentBalance: NAIRA(8_400_000),
      totalContributions: NAIRA(7_300_000),
      employeeContributions: NAIRA(3_200_000),
      employerContributions: NAIRA(4_100_000),
      totalReturns: NAIRA(1_100_000),
      estimatedBenefit: NAIRA(42_800_000),
      projectionRate: 12.5,
      retirementAge: 60,
      // Deliberately a few days stale, so the provenance banner has something
      // real to report rather than always saying "just now".
      lastSyncedAt: new Date(Date.now() - 3 * 86_400_000),
      statements: {
        create: [
          { periodStart: new Date('2026-04-01'), periodEnd: new Date('2026-06-30'), openingBalance: NAIRA(8_050_000), closingBalance: NAIRA(8_400_000), totalCredits: NAIRA(270_000), totalReturns: NAIRA(80_000), documentKey: 'statements/demo-q2.pdf' },
          { periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-03-31'), openingBalance: NAIRA(7_720_000), closingBalance: NAIRA(8_050_000), totalCredits: NAIRA(270_000), totalReturns: NAIRA(60_000), documentKey: 'statements/demo-q1.pdf' },
        ],
      },
    },
  });

  // ── Saved recipients & notifications ─────────────────────────────────────
  for (const [label, number, type] of [
    ['Mum', '+2348031234567', 'AIRTIME'],
    ['Me', '+2348061112233', 'DATA'],
  ] as const) {
    await prisma.savedRecipient.create({
      data: {
        userId: user.id,
        label,
        serviceType: type,
        network: 'MTN',
        recipientEncrypted: crypto.encrypt(number),
        recipientMasked: `${number.replace('+234', '0').slice(0, 4)}•••${number.slice(-4)}`,
        recipientBlindIndex: crypto.blindIndex(number),
        isFavourite: label === 'Mum',
        lastUsedAt: new Date(),
        useCount: 12,
      },
    });
  }

  await prisma.notification.createMany({
    data: [
      { userId: user.id, category: 'SERVICE', title: 'Purchase successful', body: 'Your ₦500 MTN airtime for 0803•••4567 was delivered.', actionUrl: '/services/history/EVS-8F3K2M9Q' },
      { userId: user.id, category: 'HEALTH', title: 'Your cover renews in 24 days', body: 'Family HMO Plan renews on 20 August 2026. Auto-renewal is on.', actionUrl: '/health' },
      { userId: user.id, category: 'SERVICE', title: 'Purchase is being confirmed', body: 'We are confirming your DStv Compact subscription with the provider.', actionUrl: '/services/history/EVS-K4LP7Q2M' },
    ],
  });

  console.log(`✓ demo user ready

    Email:    ${email}
    Password: Correct-Horse7-Battery

  Signing in from a new device issues a real OTP challenge — the code is
  printed to the API log outside production.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
