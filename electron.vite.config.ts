import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          topbar: resolve(__dirname, "src/preload/topbar.ts"),
          sidebar: resolve(__dirname, "src/preload/sidebar.ts"),
          home: resolve(__dirname, "src/preload/home.ts"),
          agentOverlay: resolve(__dirname, "src/preload/agentOverlay.ts"),
          mini: resolve(__dirname, "src/preload/mini.ts"),
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    /** Serve repo `resources/` PNGs at `/filename.png` in dev and copy them into the renderer build. */
    publicDir: resolve(__dirname, "resources"),
    build: {
      rollupOptions: {
        input: {
          topbar: resolve(__dirname, "src/renderer/topbar/index.html"),
          sidebar: resolve(__dirname, "src/renderer/sidebar/index.html"),
          home: resolve(__dirname, "src/renderer/home/index.html"),
          report: resolve(__dirname, "src/renderer/report/index.html"),
          agentOverlayGlow: resolve(
            __dirname,
            "src/renderer/agent-overlay/glow/index.html",
          ),
          agentOverlayBar: resolve(
            __dirname,
            "src/renderer/agent-overlay/bar/index.html",
          ),
          mini: resolve(__dirname, "src/renderer/mini/index.html"),
        },
      },
    },
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@common": resolve("src/renderer/common"),
      },
    },
    plugins: [react()],
    server: {
      fs: {
        allow: [".."],
      },
    },
  },
});
