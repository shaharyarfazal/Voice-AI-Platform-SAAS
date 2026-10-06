import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Document parsers for the knowledge base load from node_modules at runtime.
  serverExternalPackages: ["unpdf", "mammoth"],
};

export default nextConfig;
