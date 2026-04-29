/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @node-rs/jieba 是原生 napi-rs 模块，不能被打包
  serverExternalPackages: ['@node-rs/jieba'],
};

export default nextConfig;
