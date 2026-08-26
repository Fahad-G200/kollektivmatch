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

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function safeErrorResponse(error: unknown, headers: HeadersInit = {}) {
  if (error instanceof PublicError) {
    return jsonResponse({ error: error.code, message: error.message }, error.status, headers);
  }
  console.error('Uventet serverfeil', error instanceof Error ? error.message : 'UNKNOWN');
  return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Noe gikk galt. Prøv igjen senere.' }, 500, headers);
}

export async function readJsonObject(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new PublicError(400, 'INVALID_JSON', 'Forespørselen har ugyldig format.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PublicError(400, 'INVALID_BODY', 'Forespørselen har ugyldig innhold.');
  }
  return value as Record<string, unknown>;
}

