const fs = require("node:fs");
const path = require("node:path");

function versionFromTag(tag) {
  const match = /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(
    tag || "",
  );
  if (!match)
    throw new Error(
      "Release tag must be vMAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH, for example v1.0.5",
    );
  return match[1];
}

if (require.main === module) {
  const version = versionFromTag(process.env.RELEASE_TAG);
  const root = path.join(__dirname, "..");
  const pkgPath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  pkg.version = lock.version = lock.packages[""].version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  console.log(`Building Screen Harbor ${version}`);
}
module.exports = { versionFromTag };
