// Sent with every response, static files included. Keeps other sites from framing the app
// (clickjacking) and browsers from guessing content types. Vercel already sends HSTS.
export const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  // The planner's lists record voice notes; the microphone stays off for other origins and frames.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
];

// The planner's old pages became tabs of /todos (Nov 2026). Old bookmarks and links land there; a
// redirect keeps its query string, so /todos/lists?list=…&item=… still opens that item.
export const plannerRedirects = [
  ...['stats', 'lists', 'review', 'goals', 'search'].map((page) => ({ source: `/todos/${page}`, destination: '/todos', permanent: false })),
  { source: '/planner-next', destination: '/todos', permanent: false },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: 'image.tmdb.org' }] },
  async redirects() {
    return plannerRedirects;
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default nextConfig;
