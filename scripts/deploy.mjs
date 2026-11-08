import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DEBUG_APP_ID, MAIN_ACTIVITY, androidEnv, debugApk, tools } from "./android-env.mjs";

const env = androidEnv();
const serial = process.argv.slice(2);
const run = (...args) => {
  const r = spawnSync(tools.adb(), [...serial, ...args], { env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!existsSync(debugApk)) {
  console.error(`APK missing: ${debugApk}
Run "npm run apk:debug" first.`);
  process.exit(1);
}
run("install", "-r", debugApk);
run("shell", "am", "start", "-n", `${DEBUG_APP_ID}/${MAIN_ACTIVITY}`);
