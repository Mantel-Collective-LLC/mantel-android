import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const androidDir = join(appRoot, "android");
const isWindows = process.platform === "win32";
const exe = (name) => (isWindows ? `${name}.exe` : name);

function firstExisting(candidates) {
  return candidates.find((c) => c && existsSync(c)) ?? null;
}

export function javaHome() {
  return firstExisting([
    process.env.JAVA_HOME,
    isWindows ? "C:/Program Files/Android/Android Studio/jbr" : null,
    process.platform === "darwin" ? "/Applications/Android Studio.app/Contents/jbr/Contents/Home" : null,
    "/opt/android-studio/jbr",
  ]);
}

export function androidHome() {
  return firstExisting([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    isWindows && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : null,
    process.platform === "darwin" ? join(homedir(), "Library", "Android", "sdk") : join(homedir(), "Android", "Sdk"),
  ]);
}

export function androidEnv() {
  const java = javaHome();
  const sdk = androidHome();
  if (!java) throw new Error("JDK not found: set JAVA_HOME (e.g. Android Studio/jbr).");
  if (!sdk) throw new Error("Android SDK not found: set ANDROID_HOME.");
  const sep = isWindows ? ";" : ":";
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  return {
    ...process.env,
    JAVA_HOME: java,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    [pathKey]: [join(java, "bin"), join(sdk, "platform-tools"), join(sdk, "emulator"), process.env[pathKey]].join(sep),
  };
}

export const tools = {
  adb: () => join(androidHome() ?? "", "platform-tools", exe("adb")),
  emulator: () => join(androidHome() ?? "", "emulator", exe("emulator")),
};

export const APP_ID = "net.mantel.app";
export const DEBUG_APP_ID = `${APP_ID}.debug`;
export const MAIN_ACTIVITY = "net.mantel.app.MainActivity";
export const DEFAULT_AVD = "Medium_Phone_API_36.1";
export const debugApk = join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
export const releaseApk = join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
export const releaseUnsignedApk = join(androidDir, "app", "build", "outputs", "apk", "release", "app-release-unsigned.apk");
