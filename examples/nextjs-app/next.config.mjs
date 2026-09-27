/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship ESM/TS that Next should transpile itself.
  transpilePackages: ['@scormflow/sdk', '@scormflow/player', '@scormflow/react'],
};

export default nextConfig;
