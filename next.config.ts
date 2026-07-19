import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root: a stray lockfile in a parent directory otherwise
  // makes Next infer the wrong root. __dirname keeps it machine-agnostic.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
