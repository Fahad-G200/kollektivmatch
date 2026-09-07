// Vipps account verification was retired from the product. Keep both entry
// points closed, including callbacks from previously started sessions. A future
// implementation must bind approval to the initiating browser before linking.
Deno.serve(() => new Response(JSON.stringify({
  error: 'VERIFICATION_RETIRED',
  message: 'Vipps-kontobekreftelse er avviklet.',
}), {
  status: 410,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
}));
