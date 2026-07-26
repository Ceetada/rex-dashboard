import { BadRequestException, Body, PipeTransform, Injectable, type ArgumentMetadata } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates request bodies against the *same* Zod schemas the frontend uses,
 * from @evas/contracts. Sharing the schema is the point: the client and server
 * cannot drift into disagreeing about what a valid phone number is.
 *
 * Zod strips unknown keys, which also gives us mass-assignment protection for
 * free — a client cannot smuggle `{ "kycTier": "TIER_3" }` into a profile
 * update, because the field is not in the schema and never reaches the service.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    // Flatten into { field: [messages] } so the client can attach each error to
    // the input that caused it rather than showing one generic banner.
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.') || '_';
      (fieldErrors[path] ??= []).push(issue.message);
    }

    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: result.error.issues[0]?.message ?? 'Check the highlighted fields',
      fields: fieldErrors,
    });
  }
}

/** `@ZodBody(loginSchema) body: unknown` — terser than piping at every call site. */
export const ZodBody = (schema: ZodSchema) => Body(new ZodValidationPipe(schema));
