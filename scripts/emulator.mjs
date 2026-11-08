import { spawn, spawnSync } from "node:child_process";
import { DEFAULT_AVD, androidEnv, tools } from "./android-env.mjs";

const env = androidEnv();
const avd = process.argv[2] ?? process.env.MANTEL_AVD ?? DEFAULT_AVD;
const adb = (...args) => spawnSync(tools.adb(), args, { env, encoding: "utf8" });

const running = adb("devices").stdout.split("\n").some((l) => /^emulator-\d+\s+device/.test(l));
if (running) {
  console.log("Emulator is already running.");
} else {
  console.log(`Starting emulator ${avd} …`);
  spawn(tools.emulator(), ["-avd", avd, "-no-snapshot-save", "-no-boot-anim"], {
    env,
    detached: true,
    stdio: "ignore",
  }).unref();
}

adb("wait-for-device");
const deadline = Date.now() + 5 * 60_000;
while (Date.now() < deadline) {
  if (adb("shell", "getprop", "sys.boot_completed").stdout.trim() === "1") {
    console.log("Emulator is ready.");
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.error("Emulator did not boot in time.");
process.exit(1);
