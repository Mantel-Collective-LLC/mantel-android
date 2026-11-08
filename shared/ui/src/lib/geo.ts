import type { VpnNode } from "../../../core/contract";
import { fold } from "./locations";

export type LatLon = { lat: number; lon: number };

const CITIES: Record<string, readonly [number, number]> = {
  amsterdam: [52.37, 4.9],
  athen: [37.98, 23.73],
  athens: [37.98, 23.73],
  atlanta: [33.75, -84.39],
  auckland: [-36.85, 174.76],
  bangkok: [13.76, 100.5],
  barcelona: [41.39, 2.17],
  belgrad: [44.79, 20.45],
  belgrade: [44.79, 20.45],
  berlin: [52.52, 13.4],
  bern: [46.95, 7.45],
  bogota: [4.71, -74.07],
  boston: [42.36, -71.06],
  bratislava: [48.15, 17.11],
  brussel: [50.85, 4.35],
  brussels: [50.85, 4.35],
  bruxelles: [50.85, 4.35],
  bukarest: [44.43, 26.1],
  bucharest: [44.43, 26.1],
  budapest: [47.5, 19.04],
  "buenos aires": [-34.6, -58.38],
  chicago: [41.88, -87.63],
  chisinau: [47.01, 28.86],
  dallas: [32.78, -96.8],
  denver: [39.74, -104.99],
  dubai: [25.2, 55.27],
  dublin: [53.35, -6.26],
  dusseldorf: [51.23, 6.78],
  duesseldorf: [51.23, 6.78],
  frankfurt: [50.11, 8.68],
  "frankfurt am main": [50.11, 8.68],
  genf: [46.2, 6.14],
  geneva: [46.2, 6.14],
  hamburg: [53.55, 9.99],
  helsinki: [60.17, 24.94],
  "ho chi minh city": [10.82, 106.63],
  hongkong: [22.32, 114.17],
  "hong kong": [22.32, 114.17],
  istanbul: [41.01, 28.98],
  jakarta: [-6.21, 106.85],
  johannesburg: [-26.2, 28.05],
  kapstadt: [-33.92, 18.42],
  "cape town": [-33.92, 18.42],
  kiew: [50.45, 30.52],
  kyiv: [50.45, 30.52],
  kopenhagen: [55.68, 12.57],
  copenhagen: [55.68, 12.57],
  koln: [50.94, 6.96],
  koeln: [50.94, 6.96],
  cologne: [50.94, 6.96],
  kowloon: [22.32, 114.18],
  "kuala lumpur": [3.14, 101.69],
  lissabon: [38.72, -9.14],
  lisbon: [38.72, -9.14],
  ljubljana: [46.06, 14.51],
  london: [51.51, -0.13],
  "los angeles": [34.05, -118.24],
  luxemburg: [49.61, 6.13],
  luxembourg: [49.61, 6.13],
  madrid: [40.42, -3.7],
  mailand: [45.46, 9.19],
  milan: [45.46, 9.19],
  manchester: [53.48, -2.24],
  marseille: [43.3, 5.37],
  melbourne: [-37.81, 144.96],
  "mexico city": [19.43, -99.13],
  "mexiko-stadt": [19.43, -99.13],
  miami: [25.76, -80.19],
  montreal: [45.5, -73.57],
  moskau: [55.76, 37.62],
  moscow: [55.76, 37.62],
  mumbai: [19.08, 72.88],
  munchen: [48.14, 11.58],
  muenchen: [48.14, 11.58],
  munich: [48.14, 11.58],
  "new york": [40.71, -74.01],
  "new york city": [40.71, -74.01],
  nurnberg: [49.45, 11.08],
  nuremberg: [49.45, 11.08],
  oslo: [59.91, 10.75],
  osaka: [34.69, 135.5],
  paris: [48.86, 2.35],
  phoenix: [33.45, -112.07],
  prag: [50.08, 14.44],
  prague: [50.08, 14.44],
  reykjavik: [64.15, -21.94],
  riga: [56.95, 24.11],
  rom: [41.9, 12.5],
  rome: [41.9, 12.5],
  rotterdam: [51.92, 4.48],
  "san francisco": [37.77, -122.42],
  "san jose": [37.34, -121.89],
  santiago: [-33.45, -70.67],
  "sao paulo": [-23.55, -46.63],
  seattle: [47.61, -122.33],
  seoul: [37.57, 126.98],
  singapur: [1.35, 103.82],
  singapore: [1.35, 103.82],
  sofia: [42.7, 23.32],
  stockholm: [59.33, 18.07],
  sydney: [-33.87, 151.21],
  taipeh: [25.03, 121.57],
  taipei: [25.03, 121.57],
  tallinn: [59.44, 24.75],
  "tel aviv": [32.09, 34.78],
  tirana: [41.33, 19.82],
  tokio: [35.68, 139.69],
  tokyo: [35.68, 139.69],
  toronto: [43.65, -79.38],
  vancouver: [49.28, -123.12],
  vilnius: [54.69, 25.28],
  warschau: [52.23, 21.01],
  warsaw: [52.23, 21.01],
  washington: [38.91, -77.04],
  wien: [48.21, 16.37],
  vienna: [48.21, 16.37],
  zagreb: [45.82, 15.98],
  zurich: [47.38, 8.54],
  zuerich: [47.38, 8.54],
};

const COUNTRIES: Record<string, readonly [number, number]> = {
  AE: [25.2, 55.27], AL: [41.33, 19.82], AM: [40.18, 44.51], AR: [-34.6, -58.38], AT: [48.21, 16.37],
  AU: [-33.87, 151.21], BA: [43.86, 18.41], BD: [23.81, 90.41], BE: [50.85, 4.35], BG: [42.7, 23.32],
  BR: [-23.55, -46.63], BY: [53.9, 27.56], CA: [43.65, -79.38], CH: [47.38, 8.54], CL: [-33.45, -70.67],
  CN: [31.23, 121.47], CO: [4.71, -74.07], CR: [9.93, -84.09], CY: [35.17, 33.36], CZ: [50.08, 14.44],
  DE: [50.11, 8.68], DK: [55.68, 12.57], EE: [59.44, 24.75], EG: [30.04, 31.24], ES: [40.42, -3.7],
  FI: [60.17, 24.94], FR: [48.86, 2.35], GB: [51.51, -0.13], GE: [41.72, 44.79], GR: [37.98, 23.73],
  HK: [22.32, 114.17], HR: [45.82, 15.98], HU: [47.5, 19.04], ID: [-6.21, 106.85], IE: [53.35, -6.26],
  IL: [32.09, 34.78], IN: [19.08, 72.88], IS: [64.15, -21.94], IT: [45.46, 9.19], JP: [35.68, 139.69],
  KE: [-1.29, 36.82], KR: [37.57, 126.98], KZ: [43.24, 76.89], LT: [54.69, 25.28], LU: [49.61, 6.13],
  LV: [56.95, 24.11], MA: [33.57, -7.59], MD: [47.01, 28.86], ME: [42.44, 19.26], MK: [41.99, 21.43],
  MT: [35.9, 14.51], MX: [19.43, -99.13], MY: [3.14, 101.69], NG: [6.52, 3.38], NL: [52.37, 4.9],
  NO: [59.91, 10.75], NZ: [-36.85, 174.76], PE: [-12.05, -77.04], PH: [14.6, 120.98], PK: [24.86, 67.0],
  PL: [52.23, 21.01], PT: [38.72, -9.14], RO: [44.43, 26.1], RS: [44.79, 20.45], RU: [55.76, 37.62],
  SA: [24.71, 46.68], SE: [59.33, 18.07], SG: [1.35, 103.82], SI: [46.06, 14.51], SK: [48.15, 17.11],
  TH: [13.76, 100.5], TR: [41.01, 28.98], TW: [25.03, 121.57], UA: [50.45, 30.52], US: [40.71, -74.01],
  UY: [-34.9, -56.16], VN: [10.82, 106.63], ZA: [-26.2, 28.05],
};

const toLatLon = (pair: readonly [number, number] | undefined): LatLon | null =>
  pair ? { lat: pair[0], lon: pair[1] } : null;

export function locationCoordinates(node: Pick<VpnNode, "city" | "country">): LatLon | null {
  const city = fold(node.city);
  return toLatLon(CITIES[city] ?? CITIES[city.replace(/-/g, " ")]) ?? toLatLon(COUNTRIES[node.country.toUpperCase()]);
}

export function approximateHome(timeZone: string | undefined, locale: string | undefined): LatLon | null {
  if (timeZone && timeZone.includes("/")) {
    const city = fold(timeZone.split("/").at(-1)?.replace(/_/g, " ") ?? "");
    const match = toLatLon(CITIES[city] ?? CITIES[TIME_ZONE_ALIASES[city] ?? ""]);
    if (match) return match;
  }
  const region = locale ? /[-_]([A-Za-z]{2})\b/.exec(locale)?.[1]?.toUpperCase() : undefined;
  return region ? toLatLon(COUNTRIES[region]) : null;
}

const TIME_ZONE_ALIASES: Record<string, string> = {
  busingen: "zurich",
  kiev: "kyiv",
  "hong kong": "hongkong",
  calcutta: "mumbai",
  kolkata: "mumbai",
  "sao paulo": "sao paulo",
};

export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
