export class PublicError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
    this.code = code;
  }
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_JSON_LIMIT = 64 * 1024;

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

export function safeErrorResponse(error: unknown, headers: HeadersInit = {}) {
  if (error instanceof PublicError) {
    return jsonResponse({ error: error.code, message: error.message }, error.status, headers);
  }
  console.error('Uventet serverfeil', error instanceof Error ? error.message : 'UNKNOWN');
  return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Noe gikk galt. Prøv igjen senere.' }, 500, headers);
}

export async function readTextBody(request: Request, maxBytes: number) {
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    throw new PublicError(413, 'BODY_TOO_LARGE', 'Forespørselen er for stor.');
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    throw new PublicError(413, 'BODY_TOO_LARGE', 'Forespørselen er for stor.');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function readJsonObject(request: Request, maxBytes = DEFAULT_JSON_LIMIT) {
  const contentType = request.headers.get('content-type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new PublicError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Forespørselen må være JSON.');
  }
  let raw: string;
  try {
    raw = await readTextBody(request, maxBytes);
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(400, 'INVALID_JSON', 'Forespørselen har ugyldig format.');
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'INVALID_JSON', 'Forespørselen har ugyldig format.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PublicError(400, 'INVALID_BODY', 'Forespørselen har ugyldig innhold.');
  }
  return value as Record<string, unknown>;
}
