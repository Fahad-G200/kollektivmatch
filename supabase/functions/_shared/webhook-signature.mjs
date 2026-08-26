const encoder = new TextEncoder();

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

export function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  if (!a.length || !b.length) return a.length === b.length;
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= a[index % a.length] ^ b[index % b.length];
  }
  return difference === 0;
}

export async function sha256Base64(content) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(content));
  return bytesToBase64(new Uint8Array(digest));
}

export async function buildVippsAuthorization({ secret, method = 'POST', pathAndQuery, date, host, contentHash }) {
  const signedString = `${method}\n${pathAndQuery}\n${date};${host};${contentHash}`;
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signedString));
  return `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${bytesToBase64(new Uint8Array(signature))}`;
}

