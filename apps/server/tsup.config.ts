import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  clean: true,
  sourcemap: true,
  external: ["argon2", "@prisma/adapter-pg", "@prisma/client", "@prisma/client/runtime/client", "pg"],
  noExternal: [/^@game-platform\//u]
});
