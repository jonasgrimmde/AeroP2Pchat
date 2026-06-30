const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const projectConfig = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const workflow = "pages.yml";
const ref = projectConfig.branch || "main";
const repo = projectConfig.repo;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`Triggering GitHub Pages deploy for ${repo} on ${ref}...`);
run("gh", ["workflow", "run", workflow, "--repo", repo, "--ref", ref]);
console.log("GitHub Pages workflow triggered.");
