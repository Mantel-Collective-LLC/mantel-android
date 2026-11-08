/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { DEBUG_API_URL, resolveApiUrl } from "./shared/core/api-url";

const root = dirname(fileURLToPath(import.meta.url));
const shared = resolve(root, "shared");
const renderer = resolve(shared, "ui/src");

const normalize = (p: string) => p.replace(/\\/g, "/").toLowerCase();

type Flavor = "debug" | "prod";
function flavorOf(mode: string): Flavor {
  return mode === "debug" || mode === "development" || mode === "test" ? "debug" : "prod";
}

function packageVersion(file: string): string {
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function desktopStyles(): Plugin {
  const desktopCss = normalize(resolve(renderer, "styles.css"));
  const wrapper = resolve(root, "src/styles.css");
  return {
    name: "mantel-desktop-styles",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !source.endsWith("styles.css")) return null;
      if (normalize(importer) === normalize(wrapper)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && normalize(resolved.id) === desktopCss) return wrapper;
      return null;
    },
  };
}

function apiUrlFor(flavor: Flavor, command: "build" | "serve", mode: string): string {
  const debugDefault = command === "serve" && mode !== "test" ? "http://localhost:5175" : DEBUG_API_URL.android;
  return resolveApiUrl(flavor, process.env.MANTEL_API_URL, { debugDefault, strict: command === "build" });
}

function androidScreens(): Plugin {
  const swaps = new Map([[normalize(resolve(renderer, "screens/login.tsx")), resolve(root, "src/ui/login.tsx")]]);
  const replacements = new Set([...swaps.values()].map(normalize));
  return {
    name: "mantel-android-screens",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !/(^|\/)login(\.tsx)?$/.test(source)) return null;
      if (replacements.has(normalize(importer))) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      return swaps.get(normalize(resolved.id)) ?? null;
    },
  };
}

function flavorMarker(flavor: Flavor): Plugin {
  return {
    name: "mantel-flavor-marker",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "mantel-flavor.json", source: `${JSON.stringify({ flavor })}\n` });
    },
  };
}

const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

const DEVELOPMENT_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' ws:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

function csp(): Plugin {
  let isBuild = false;
  return {
    name: "mantel-csp",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    transformIndexHtml(html) {
      return html.replace("%MANTEL_CSP%", isBuild ? PRODUCTION_CSP : DEVELOPMENT_CSP);
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const flavor = flavorOf(mode);
  const apiUrl = apiUrlFor(flavor, command, mode);
  return {
    root,
    base: "./",
    plugins: [desktopStyles(), androidScreens(), react(), tailwindcss(), csp(), flavorMarker(flavor)],
    define: {
      __MANTEL_FLAVOR__: JSON.stringify(flavor),
      __MANTEL_API_URL__: JSON.stringify(apiUrl),
      __MANTEL_BUILD_INFO__: JSON.stringify({
        webVersion: packageVersion(resolve(root, "package.json")),
        capacitorVersion: packageVersion(resolve(root, "node_modules/@capacitor/core/package.json")),
        builtAt: new Date().toISOString(),
        mode,
      }),
    },
    resolve: {
      alias: [
        { find: "@shared", replacement: resolve(shared, "core") },
        { find: "@desktop-main", replacement: resolve(shared, "main") },
        { find: "@renderer", replacement: renderer },
      ],
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      assetsInlineLimit: 0,
    },
    server: {
      port: 5175,
      strictPort: true,
      fs: { allow: [root] },
      proxy: {
        "/api": { target: process.env.MANTEL_DEV_API ?? "http://localhost:3000", changeOrigin: true },
      },
    },
    test: {
      root,
      include: ["src/**/*.test.ts"],
      environment: "node",
    },
  };
});
