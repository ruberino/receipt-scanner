import { ApiRequestError } from '../api/client.ts';

/** The client shows `message` for a 4xx (ADR behaviour); anything else gets a generic message. */
export function apiErrorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Noe gikk galt';
}
