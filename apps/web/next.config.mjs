/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@morpho-dashboard/core', '@morpho-dashboard/db'],
  // Resolve `.js` ESM imports inside our TS workspace packages to `.ts`.
  // (tsc in bundler mode does this implicitly; webpack needs the explicit alias.)
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx'],
    };
    return config;
  },
};

export default nextConfig;
