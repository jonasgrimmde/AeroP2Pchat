const { spawn } = require("node:child_process");
const { join } = require("node:path");

const command = process.argv[2] || "dev";
const bin = join(__dirname, "..", "node_modules", "electron-vite", "dist", "cli.mjs");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(process.execPath, [bin, command], {
  cwd: join(__dirname, ".."),
  env,
  stdio: "inherit",
  shell: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
