import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Nest ships no 429 exception, so we define one rather than reaching for a
 * loosely-related status. Rate limiting and account lockout both need to say
 * "slow down" distinctly from "you are not allowed".
 */
export class TooManyRequestsException extends HttpException {
  constructor(response: { code: string; message: string } & Record<string, unknown>) {
    super(response, HttpStatus.TOO_MANY_REQUESTS);
  }
}
