import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O atualizador automático alterna entre duas pastas de build: monta a
  // versão nova numa enquanto a outra continua no ar
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
