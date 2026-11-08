export type Flavor = "debug" | "prod";

export const BUILD_FLAVOR: Flavor = __MANTEL_FLAVOR__;

export const API_BASE_URL: string = __MANTEL_API_URL__;
