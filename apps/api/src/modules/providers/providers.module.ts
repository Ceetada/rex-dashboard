import { Global, Module, OnModuleInit } from '@nestjs/common';

import { VtpassAdapter } from './adapters/vtpass.adapter';
import { PaystackAdapter } from './adapters/paystack.adapter';
import { ProviderRegistry } from './provider.registry';

/**
 * Adapters self-register at boot. Adding a new integration is: write the
 * adapter, list it here, insert a `providers` row. Nothing in the domain
 * changes.
 */
@Global()
@Module({
  providers: [ProviderRegistry, VtpassAdapter, PaystackAdapter],
  exports: [ProviderRegistry],
})
export class ProvidersModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly vtpass: VtpassAdapter,
    private readonly paystack: PaystackAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.vtpass);
    this.registry.register(this.paystack);
  }
}
