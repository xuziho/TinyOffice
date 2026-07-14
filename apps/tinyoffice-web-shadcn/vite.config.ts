import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const runtimeOrigin = env.TINYOFFICE_RUNTIME_ORIGIN || "http://127.0.0.1:8095";

  return {
    plugins: [react(), tailwindcss()],
    build: {
      manifest: true,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "localhost",
      port: 5175,
      strictPort: true,
      proxy: {
        "/api": {
          target: runtimeOrigin,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4175,
    },
  };
});
