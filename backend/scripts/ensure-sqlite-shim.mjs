// Local-developer affordance, runs automatically after `npm install`
// (see the postinstall script in package.json).
//
// better-sqlite3 ships prebuilt binaries for a fixed set of Node ABI
// versions. On machines where no prebuild matches (e.g. a brand-new Node
// on Windows) and no C++ toolchain is installed, npm cannot compile the
// native binding and every `require("better-sqlite3")` fails with
// "Could not locate the bindings file" — which takes the whole backend
// down with it.
//
// When (and only when) that happens, this script points the
// better-sqlite3 package at libsql, a drop-in API-compatible SQLite
// implementation with a WASM engine — no native build required. On
// machines where the native binding loads fine (CI, the Docker image on
// node:20-alpine) this script does nothing at all, so production keeps
// running the real better-sqlite3.
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require_ = createRequire(import.meta.url);
const pkgDir = path.join(process.cwd(), "node_modules", "better-sqlite3");
const pkgPath = path.join(pkgDir, "package.json");

function nativeBindingWorks() {
  try {
    // The real package's main entry (lib/index.js) throws at require time
    // when the .node binding is missing.
    require_("better-sqlite3");
    return true;
  } catch {
    return false;
  }
}

function shimApplied() {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg.main === "shim.js" && fs.existsSync(path.join(pkgDir, "shim.js"))) {
      require_(path.join(pkgDir, "shim.js"));
      return true;
    }
  } catch {
    /* libsql missing or shim broken — re-apply below */
  }
  return false;
}

if (nativeBindingWorks()) {
  console.log("[ensure-sqlite-shim] native better-sqlite3 binding loads — no shim needed.");
  process.exit(0);
}

if (shimApplied()) {
  console.log("[ensure-sqlite-shim] shim already active (libsql backend).");
  process.exit(0);
}

try {
  // libsql is a devDependency — it exists on dev machines. If someone
  // pruned it, say so instead of leaving a broken package behind.
  require_("libsql");
} catch {
  console.error(
    "[ensure-sqlite-shim] native binding missing AND libsql not installed.\n" +
      "Run: npm install --save-dev libsql   (then reinstall to re-run this script)"
  );
  process.exit(1);
}

fs.writeFileSync(path.join(pkgDir, "shim.js"), "module.exports = require('libsql');\n");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.main = "shim.js";
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
console.log(
  "[ensure-sqlite-shim] native binding unavailable on this machine — " +
    "better-sqlite3 now resolves to the API-compatible libsql (WASM) backend."
);
