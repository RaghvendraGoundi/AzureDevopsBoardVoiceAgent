import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  // The migrations are read from disk at runtime; ship them with the server.
  outputFileTracingIncludes: { "/**": ["./db/migrations/*.sql"] },
  poweredByHeader: false,
  // Loaded by Node at runtime instead of bundled (they use Node-only modules).
  serverExternalPackages: ["@azure/monitor-opentelemetry", "@azure/identity", "pg"],
};

export default nextConfig;
