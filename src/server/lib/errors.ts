export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Ugyldig forespørsel', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Ikke innlogget') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Finnes ikke') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Filen er for stor') {
    super(413, 'PAYLOAD_TOO_LARGE', message);
  }
}

export type ExtractionStage = 'extraction' | 'matching';

/** A failed receipt job; `userMessage` is the Norwegian text stored on the receipt and shown in the UI. */
export class ExtractionError extends Error {
  readonly userMessage: string;
  readonly stage: ExtractionStage;

  constructor(userMessage: string, stage: ExtractionStage, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = 'ExtractionError';
    this.userMessage = userMessage;
    this.stage = stage;
  }
}

export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
};

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

/** Maps a 4xx error raised by Fastify or one of its plugins (bad JSON, rate limit, multipart size) onto an AppError. */
export function appErrorFromHttpError(error: unknown): AppError | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const { statusCode, message } = error as { statusCode?: unknown; message?: unknown };
  if (typeof statusCode !== 'number') {
    return null;
  }
  const code = CODE_BY_STATUS[statusCode];
  if (!code) {
    return null;
  }
  return new AppError(statusCode, code, typeof message === 'string' ? message : code);
}

export function toErrorResponse(error: unknown, requestId: string): ApiErrorBody {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        requestId,
      },
    };
  }

  return {
    error: {
      code: 'INTERNAL',
      message: 'Noe gikk galt',
      requestId,
    },
  };
}
