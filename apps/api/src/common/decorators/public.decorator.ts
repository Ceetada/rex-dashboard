import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Opts a handler out of JwtAuthGuard. Used sparingly — auth and health only. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
