import { spawnSync } from "node:child_process";
import { androidEnv, appRoot } from "./android-env.mjs";

const result = spawnSync("npx", ["cap", ...process.argv.slice(2)], {
  cwd: appRoot,
  env: androidEnv(),
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
