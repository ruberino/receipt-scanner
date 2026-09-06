export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId: string;

  constructor(status: number, error: ApiErrorBody) {
    super(error.message);
    this.status = status;
    this.code = error.code;
    this.details = error.details;
    this.requestId = error.requestId;
  }
}

const FALLBACK_ERROR: ApiErrorBody = { code: 'INTERNAL', message: 'Noe gikk galt', requestId: '' };

let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

const LOGIN_PATH = '/api/auth/login';

async function parseErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    const body = (await response.json()) as { error: ApiErrorBody };
    return body.error;
  } catch {
    return FALLBACK_ERROR;
  }
}

export async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Fastify rejects a request that declares Content-Type: application/json but sends no body
  // (e.g. a DELETE with no payload), so only set it when there actually is a body to parse.
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, { ...init, credentials: 'same-origin', headers });

  if (!response.ok) {
    const errorBody = await parseErrorBody(response);
    if (response.status === 401 && path !== LOGIN_PATH) {
      onUnauthorized?.();
    }
    throw new ApiRequestError(response.status, errorBody);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** Multipart upload with progress via XMLHttpRequest; fetch has no upload-progress event. */
export function uploadFile(
  path: string,
  file: File | Blob,
  onProgress?: (fraction: number) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText === '' ? undefined : (JSON.parse(xhr.responseText) as unknown));
        return;
      }

      let errorBody: ApiErrorBody;
      try {
        errorBody = (JSON.parse(xhr.responseText) as { error: ApiErrorBody }).error;
      } catch {
        errorBody = FALLBACK_ERROR;
      }
      if (xhr.status === 401) {
        onUnauthorized?.();
      }
      reject(new ApiRequestError(xhr.status, errorBody));
    };

    xhr.onerror = () => {
      reject(new ApiRequestError(0, FALLBACK_ERROR));
    };

    const formData = new FormData();
    formData.append('image', file);
    xhr.send(formData);
  });
}
