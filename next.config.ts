import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `npm run build:check` builds into .next-build so it never clobbers a running dev server's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // There are no plans to pick any more; old links to the pricing page go home.
  async redirects() {
    return [{ source: "/pricing", destination: "/", permanent: false }];
  },
};

export default nextConfig;
