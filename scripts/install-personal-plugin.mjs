#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const pluginName = "agent-advisor";
const home = os.homedir();
const pluginParent = path.join(home, "plugins");
const pluginPath = path.join(pluginParent, pluginName);
const marketplacePath = path.join(home, ".agents", "plugins", "marketplace.json");

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

async function loadMarketplace() {
  try {
    return JSON.parse(await fsp.readFile(marketplacePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return {
      name: "personal",
      interface: {
        displayName: "Personal",
      },
      plugins: [],
    };
  }
}

async function main() {
  run("npm", ["run", "build"]);
  await fsp.mkdir(pluginParent, { recursive: true });
  await fsp.mkdir(path.dirname(marketplacePath), { recursive: true });

  try {
    const stat = await fsp.lstat(pluginPath);
    if (stat.isSymbolicLink()) {
      await fsp.unlink(pluginPath);
    } else {
      const existingReal = await fsp.realpath(pluginPath);
      const repoReal = await fsp.realpath(repoRoot);
      if (existingReal !== repoReal) {
        throw new Error(
          `${pluginPath} already exists and is not a symlink to this repo. Move it aside or remove it before installing.`
        );
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  if (!fs.existsSync(pluginPath)) {
    await fsp.symlink(repoRoot, pluginPath, "dir");
  }

  const marketplace = await loadMarketplace();
  marketplace.name = marketplace.name || "personal";
  marketplace.interface = marketplace.interface || { displayName: "Personal" };
  marketplace.plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];

  const entry = {
    name: pluginName,
    source: {
      source: "local",
      path: `./plugins/${pluginName}`,
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: "Productivity",
  };

  const index = marketplace.plugins.findIndex((plugin) => plugin && plugin.name === pluginName);
  if (index >= 0) {
    marketplace.plugins[index] = entry;
  } else {
    marketplace.plugins.push(entry);
  }

  await fsp.writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");
  console.log(`Linked ${pluginPath} -> ${repoRoot}`);
  console.log(`Updated ${marketplacePath}`);
  console.log(`Next: codex plugin add ${pluginName}@${marketplace.name}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
