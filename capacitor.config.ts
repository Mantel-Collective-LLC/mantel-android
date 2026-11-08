import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "net.mantel.app",
  appName: "Mantel",
  webDir: "dist",
  backgroundColor: "#fafaf9",
  loggingBehavior: "none",
  server: {
    androidScheme: "https",
  },
  android: {
    backgroundColor: "#fafaf9",
  },
  plugins: {
    CapacitorHttp: { enabled: true },
    SystemBars: { style: "DEFAULT", insetsHandling: "css", initialViewportFitValueHint: "cover" },
  },
};

export default config;
