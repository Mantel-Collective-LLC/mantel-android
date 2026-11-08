/// <reference types="vite/client" />

interface Window {
  mantel?: import("@shared/contract").MantelBridge;
}

declare const __MANTEL_FLAVOR__: "debug" | "prod";

declare const __MANTEL_API_URL__: string;

declare const __MANTEL_BUILD_INFO__: {
  webVersion: string;
  capacitorVersion: string;
  builtAt: string;
  mode: string;
};

declare module "@renderer/main";
