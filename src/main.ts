import { App } from "@capacitor/app";
import { bootTheme } from "@renderer/lib/theme-dom";
import { createAndroidBridge } from "./bridge/android-bridge";
import type { AndroidBridge } from "./bridge/extras";

bootTheme();

void App.addListener("backButton", () => {
  const event = new CustomEvent("mantel:back", { cancelable: true });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) void App.minimizeApp();
});

async function start(): Promise<void> {
  let bridge: AndroidBridge;
  if (__MANTEL_FLAVOR__ === "debug") {
    const { createDebugBridge } = await import("./debug/index");
    bridge = createDebugBridge();
  } else {
    bridge = createAndroidBridge();
  }
  window.mantel = bridge;
  await import("@renderer/main");
}

start().catch((error: unknown) => {
  console.error("Mantel: Oberfläche konnte nicht geladen werden", error);
});
