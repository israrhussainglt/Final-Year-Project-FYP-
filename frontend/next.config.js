/** @type {import('next').NextConfig} */
const apiOrigin = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // Produces a self-contained .next/standalone build (server + only the
  // node_modules it actually needs) so the Docker runtime image doesn't
  // have to ship the full node_modules tree.
  output: "standalone",
  async headers() {
    return [
      {
        // Applies to every route — sensible defaults for a healthcare app
        // handling session cookies and patient data. connect-src includes
        // the backend API origin since the frontend now talks to it over
        // plain fetch() instead of same-origin Next.js API routes.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ${apiOrigin}; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
