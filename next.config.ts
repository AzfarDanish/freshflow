import type { NextConfig } from "next";

const replitDevHost = process.env.REPLIT_DEV_DOMAIN?.split(":")[0];

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    ...(replitDevHost ? [replitDevHost] : []),
  ],
};

export default nextConfig;
