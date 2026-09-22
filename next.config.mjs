/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Postgres driver and Prisma's engine load native/dynamic code and must
  // stay real server-side requires rather than being traced into the bundle.
  serverExternalPackages: ['pg', '@prisma/client', '@prisma/adapter-pg'],
  experimental: {
    // Server Actions carry the Cloudinary upload callbacks and admin forms; the
    // files themselves go browser-to-Cloudinary and never through this limit.
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
