import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { androidDir, androidEnv, androidHome, debugApk, releaseApk, releaseUnsignedApk } from "./android-env.mjs";

const isWindows = process.platform === "win32";
const env = androidEnv();

const localProperties = join(androidDir, "local.properties");
if (!existsSync(localProperties)) {
  const sdkDir = androidHome().replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  writeFileSync(localProperties, `sdk.dir=${sdkDir}\n`);
}

const args = process.argv.slice(2);
const wrapper = join(androidDir, isWindows ? "gradlew.bat" : "gradlew");
const result = spawnSync(isWindows ? `"${wrapper}"` : wrapper, args.length ? args : ["assembleDebug"], {
  cwd: androidDir,
  env,
  stdio: "inherit",
  shell: isWindows,
});
const report = (label, apk) => {
  const mb = (statSync(apk).size / 1024 / 1024).toFixed(1);
  console.log(`\n${label}: ${apk} (${mb} MB)`);
};
if (result.status === 0 && existsSync(debugApk) && (args.length === 0 || args.includes("assembleDebug"))) {
  report("APK (debug, Mantel Debug)", debugApk);
}
const mtime = (apk) => (existsSync(apk) ? statSync(apk).mtimeMs : -1);
if (result.status === 0 && args.includes("assembleRelease") && Math.max(mtime(releaseApk), mtime(releaseUnsignedApk)) >= 0) {
  if (mtime(releaseApk) >= mtime(releaseUnsignedApk)) report("APK (prod, Mantel, signed)", releaseApk);
  else report("APK (prod, Mantel, UNSIGNED: no release key found, see keystore.properties.example)", releaseUnsignedApk);
}
process.exit(result.status ?? 1);
