import { $ } from "bun"
import fs from "fs"
import path from "path"
import { pipeline } from "stream/promises"
import { createWriteStream } from "fs"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, "..")
const DIST_DIR = path.join(__dirname, "temp_build")
const BUNDLE_DIR = path.join(DIST_DIR, "content")
const NODE_VERSION = "v20.11.0"
const NODE_BASE_URL = `https://nodejs.org/dist/${NODE_VERSION}`

const NODES = [
  { platform: "win32", arch: "x64", ext: "zip", url: `${NODE_BASE_URL}/node-${NODE_VERSION}-win-x64.zip` },
  { platform: "linux", arch: "x64", ext: "tar.xz", url: `${NODE_BASE_URL}/node-${NODE_VERSION}-linux-x64.tar.xz` },
  { platform: "linux", arch: "arm64", ext: "tar.xz", url: `${NODE_BASE_URL}/node-${NODE_VERSION}-linux-arm64.tar.xz` },
  { platform: "darwin", arch: "x64", ext: "tar.gz", url: `${NODE_BASE_URL}/node-${NODE_VERSION}-darwin-x64.tar.gz` },
  {
    platform: "darwin",
    arch: "arm64",
    ext: "tar.gz",
    url: `${NODE_BASE_URL}/node-${NODE_VERSION}-darwin-arm64.tar.gz`,
  },
]

async function downloadFile(url: string, dest: string) {
  console.log(`Downloading ${url}...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.statusText}`)
  if (!res.body) throw new Error(`No body for ${url}`)

  await pipeline(res.body, createWriteStream(dest))
  console.log(`Downloaded ${path.basename(dest)}`)
}

async function main() {
  console.log("--- Starting Offline Pack ---")

  // 1. Clean and Prepare Directories
  console.log("Cleaning previous build artifacts...")
  if (fs.existsSync(DIST_DIR)) {
    console.log(`Removing existing ${DIST_DIR}...`)
    fs.rmSync(DIST_DIR, { recursive: true, force: true })
  }

  // Also remove the final zip/tar.gz if it exists to ensure a fresh build
  const zipName = "opencode-offline.tar.gz"
  const zipPath = path.join(__dirname, zipName)
  if (fs.existsSync(zipPath)) {
    console.log(`Removing existing ${zipName}...`)
    fs.rmSync(zipPath, { force: true })
  }

  fs.mkdirSync(BUNDLE_DIR, { recursive: true })
  fs.mkdirSync(path.join(BUNDLE_DIR, "bin"), { recursive: true })
  fs.mkdirSync(path.join(BUNDLE_DIR, "node"), { recursive: true })
  fs.mkdirSync(path.join(BUNDLE_DIR, "deps"), { recursive: true })

  // 2. Build Opencode (All Platforms)
  console.log("Building Opencode for all platforms...")
  const buildScript = path.join(PROJECT_ROOT, "packages", "opencode", "script", "build.ts")
  if (!fs.existsSync(buildScript)) {
    throw new Error(`Build script not found at: ${buildScript}`)
  }

  // We run the build script. Note: This might take a while.
  // Use 'bun' directly on the file path, not 'bun run' (which looks for package.json scripts)
  await $`bun ${buildScript}`.cwd(PROJECT_ROOT)

  // Copy binaries
  console.log("Copying binaries...")
  const distPath = path.join(PROJECT_ROOT, "packages", "opencode", "dist")
  if (!fs.existsSync(distPath)) throw new Error("Build failed: dist folder not found")

  const targets = fs.readdirSync(distPath)
  for (const target of targets) {
    const binPath = path.join(distPath, target, "bin")
    if (fs.existsSync(binPath)) {
      const files = fs.readdirSync(binPath)
      for (const file of files) {
        // Rename binary to include target for clarity, e.g., opencode-linux-x64
        const src = path.join(binPath, file)
        const ext = path.extname(file) // .exe or empty
        // Use the target folder name (which contains os/arch) as the filename
        // e.g. dist/opencode-windows-x64/bin/opencode.exe -> bundle/bin/opencode-windows-x64.exe
        const destName = `${target}${ext}`
        fs.copyFileSync(src, path.join(BUNDLE_DIR, "bin", destName))
        console.log(`Copied ${destName}`)
      }
    }
  }

  // 3. Download Node.js Binaries
  console.log("Downloading Node.js binaries...")
  await Promise.all(
    NODES.map((node) => {
      return downloadFile(node.url, path.join(BUNDLE_DIR, "node", path.basename(node.url)))
    }),
  )

  // 4. Prepare Dependencies
  console.log("Installing dependencies...")
  const depsPkg = {
    dependencies: {
      "@opencode-ai/plugin": "1.1.36",
      "@openauthjs/openauth": "0.0.0-20250322224806",
      "@gitlab/opencode-gitlab-auth": "1.3.3",
    },
  }
  fs.writeFileSync(path.join(BUNDLE_DIR, "deps", "package.json"), JSON.stringify(depsPkg, null, 2))

  // Create a clean .npmrc to avoid user config issues (e.g. broken proxy settings)
  fs.writeFileSync(path.join(BUNDLE_DIR, "deps", ".npmrc"), "registry=https://registry.npmjs.org/\n")

  // Install deps using npm (so we get a standard node_modules)
  // Use --userconfig to ignore the user's ~/.npmrc which might have invalid proxy settings
  await $`cd ${path.join(BUNDLE_DIR, "deps")} && npm --userconfig=.npmrc install --no-bin-links --ignore-scripts --no-audit --no-fund --omit=dev`

  // 5. Copy Install Scripts (We will create them next)
  // Assuming they exist in offline-scripts/
  console.log("Copying install scripts...")
  const scriptDir = __dirname
  if (fs.existsSync(path.join(scriptDir, "install.sh"))) {
    // Read file and convert CRLF to LF for Linux/macOS compatibility
    const content = fs.readFileSync(path.join(scriptDir, "install.sh"), "utf-8")
    const lfContent = content.replace(/\r\n/g, "\n")
    fs.writeFileSync(path.join(BUNDLE_DIR, "install.sh"), lfContent)
  }
  if (fs.existsSync(path.join(scriptDir, "install.bat"))) {
    fs.copyFileSync(path.join(scriptDir, "install.bat"), path.join(BUNDLE_DIR, "install.bat"))
  }
  if (fs.existsSync(path.join(scriptDir, "install.ps1"))) {
    fs.copyFileSync(path.join(scriptDir, "install.ps1"), path.join(BUNDLE_DIR, "install.ps1"))
  }

  // 6. Compress
  console.log("Compressing bundle...")

  // Use tar for both platforms (Windows 10+ includes tar)
  // -c: create, -z: gzip, -f: file, -C: change directory
  // We compress the CONTENTS of BUNDLE_DIR
  try {
    await $`tar -czf ${zipPath} -C ${BUNDLE_DIR} .`
  } catch (error) {
    console.error("Error using tar command. Ensure 'tar' is available in your PATH.")
    throw error
  }

  console.log(`\nSuccess! Package created at: ${zipPath}`)
  console.log(`Please copy the following files to the target machine (Machine B):`)
  console.log(`  - ${zipName}`)
  console.log(`  - install.sh (for Linux/macOS)`)
  console.log(`  - install.bat (for Windows)`)
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
