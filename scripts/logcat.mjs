import { spawn, spawnSync } from "node:child_process";
import { APP_ID, DEBUG_APP_ID, androidEnv, tools } from "./android-env.mjs";

const env = androidEnv();
const prod = process.argv.includes("--prod");
const appId = prod ? APP_ID : DEBUG_APP_ID;
const pid = spawnSync(tools.adb(), ["shell", "pidof", appId], { env, encoding: "utf8" }).stdout.trim();
const args = pid ? ["logcat", `--pid=${pid}`] : ["logcat", "Capacitor:V", "Capacitor/Console:V", "chromium:V", "AndroidRuntime:E", "*:S"];
if (!pid) console.log(`${appId} is not running: showing Capacitor/chromium/AndroidRuntime only.`);
spawn(tools.adb(), args, { env, stdio: "inherit" });
