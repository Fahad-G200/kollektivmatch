import type { NextConfig } from 'next';

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://wsfnnaiytweaarncewcr.supabase.co wss://wsfnnaiytweaarncewcr.supabase.co https://api.kartverket.no https://www.hvakosterstrommen.no",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'frame-src https://checkout.stripe.com',
  "img-src 'self' data: blob: https://wsfnnaiytweaarncewcr.supabase.co",
  "manifest-src 'self'",
  "media-src 'self' blob: https://wsfnnaiytweaarncewcr.supabase.co",
  "object-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "worker-src 'self' blob:",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(), payment=(), usb=(), browsing-topics=()' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const privatePageHeaders = [
  { key: 'Cache-Control', value: 'no-store, max-age=0' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      ...[
        '/auth-callback.html',
        '/reset-password.html',
        '/boost-payment-result.html',
        '/dashboard.html',
        '/chat.html',
        '/create-listing.html',
        '/home-seekers.html',
      ].map((source) => ({ source, headers: privatePageHeaders })),
    ];
  },
};

export default nextConfig;
