/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone 产物自动带上 server.js 与所需 node_modules，docker 运行时只需复制 .next/standalone
  output: "standalone",
}

export default nextConfig
