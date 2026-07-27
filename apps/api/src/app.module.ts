import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { z } from 'zod';

import { AuditModule } from './common/audit/audit.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { RetirementModule } from './modules/retirement/retirement.module';
import { ServicesModule } from './modules/services/services.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';

/**
 * Configuration is validated at boot, not at first use.
 *
 * A missing ENCRYPTION_KEYS should stop the process immediately, not surface
 * three hours later as a 500 the first time someone saves a BVN. Failing fast
 * on config is the cheapest reliability win available.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  COOKIE_SECRET: z.string().min(32),
  ENCRYPTION_KEYS: z.string().min(1),
  BLIND_INDEX_KEY: z.string().min(32),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  POLICY_VERSION: z.string().default('2026-01-01'),
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: (config) => {
        const result = environmentSchema.safeParse(config);
        if (!result.success) {
          const issues = result.error.issues
            .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
            .join('\n');
          throw new Error(`Invalid environment configuration:\n${issues}`);
        }
        return { ...config, ...result.data };
      },
    }),

    /**
     * Rate limiting, tiered by cost rather than applied uniformly.
     * The named tiers are attached per-route with @Throttle; this is the
     * baseline every unannotated endpoint inherits.
     */
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 10 },
      { name: 'default', ttl: 60_000, limit: 100 },
      { name: 'long', ttl: 3_600_000, limit: 1_000 },
    ]),

    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { algorithm: 'HS256' },
      }),
    }),

    ScheduleModule.forRoot(),

    PrismaModule,
    CryptoModule,
    AuditModule,
    ProvidersModule,
    AuthModule,
    UsersModule,
    WalletModule,
    HealthModule,
    RetirementModule,
    ServicesModule,
    NotificationsModule,
    AdminModule,
  ],
  providers: [
    // Order matters: throttle before we do any work, then authenticate, then
    // authorise. Registering these globally means a new controller is
    // protected by default and has to opt out explicitly.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
