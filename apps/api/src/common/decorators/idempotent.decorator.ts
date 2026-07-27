import { SetMetadata } from '@nestjs/common';

export const IS_IDEMPOTENT = 'isIdempotent';

/** Marks a mutating endpoint as replay-safe via the Idempotency-Key header. */
export const Idempotent = () => SetMetadata(IS_IDEMPOTENT, true);
