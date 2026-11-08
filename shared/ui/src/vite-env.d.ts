/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MANTEL_FLAVOR?: "prod" | "debug";
  readonly MANTEL_BUILD_TIME?: string;
}
