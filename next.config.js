/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.googleusercontent.com' },
      { protocol: 'https', hostname: '*.google.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  // Bundle the image-skill reference images with the serverless function
  // that reads them from disk (app/api/images/generate).
  experimental: {
    outputFileTracingIncludes: {
      '/api/images/generate': ['./public/image-skills/**/*'],
    },
  },
};

module.exports = nextConfig;
