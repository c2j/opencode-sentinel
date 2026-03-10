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
const NODE_VERSION = "v22.14.0"
const NODE_BASE_URL = `https://nodejs.org/dist/${NODE_VERSION}`

const args = process.argv.slice(2)
let targetPlatform: string | null = null

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: bun pack.ts [options]
Options:
  --target <platform>  Build for specific platform (e.g., darwin-arm64, linux-x64, win32-x64)
  --target all         Build for all platforms (default)
  --help, -h           Show this help message

Examples:
  bun pack.ts                      # Build for current platform
  bun pack.ts --target darwin-arm64 # Build for macOS ARM64
  bun pack.ts --target linux-x64    # Build for Linux x64
  bun pack.ts --target all          # Build for all platforms`)
  process.exit(0)
}

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--target" && args[i + 1]) {
    targetPlatform = args[i + 1] as string
    break
  }
}

const TARGET: string | null = targetPlatform
const IS_ALL = TARGET === "all" || TARGET === null

function getTargetOS(): string {
  if (!IS_ALL && TARGET) {
    const parts = TARGET.split("-")
    if (parts[0]) return parts[0]
  }
  return process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux"
}

function getTargetArch(): string {
  if (!IS_ALL && TARGET) {
    const parts = TARGET.split("-")
    if (parts[1]) return parts[1]
  }
  return process.arch === "arm64" ? "arm64" : "x64"
}

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

// MCP packages for offline use (list-based management)
const MCP_PACKAGES = ["@playwright/mcp"]

// Miniforge (Python 3.12) configuration
const MINIFORGE_VERSION = "26.1.0-0"
const MINIFORGE_BASE_URL = `https://github.com/conda-forge/miniforge/releases/download/${MINIFORGE_VERSION}`
const MINIFORGE = [
  {
    platform: "linux",
    arch: "x64",
    ext: "sh",
    url: `${MINIFORGE_BASE_URL}/Miniforge3-${MINIFORGE_VERSION}-Linux-x86_64.sh`,
    name: `Miniforge3-${MINIFORGE_VERSION}-Linux-x86_64.sh`,
  },
  {
    platform: "linux",
    arch: "arm64",
    ext: "sh",
    url: `${MINIFORGE_BASE_URL}/Miniforge3-${MINIFORGE_VERSION}-Linux-aarch64.sh`,
    name: `Miniforge3-${MINIFORGE_VERSION}-Linux-aarch64.sh`,
  },
  {
    platform: "darwin",
    arch: "x64",
    ext: "sh",
    url: `${MINIFORGE_BASE_URL}/Miniforge3-${MINIFORGE_VERSION}-MacOSX-x86_64.sh`,
    name: `Miniforge3-${MINIFORGE_VERSION}-MacOSX-x86_64.sh`,
  },
  {
    platform: "darwin",
    arch: "arm64",
    ext: "sh",
    url: `${MINIFORGE_BASE_URL}/Miniforge3-${MINIFORGE_VERSION}-MacOSX-arm64.sh`,
    name: `Miniforge3-${MINIFORGE_VERSION}-MacOSX-arm64.sh`,
  },
  {
    platform: "win32",
    arch: "x64",
    ext: "exe",
    url: `${MINIFORGE_BASE_URL}/Miniforge3-${MINIFORGE_VERSION}-Windows-x86_64.exe`,
    name: `Miniforge3-${MINIFORGE_VERSION}-Windows-x86_64.exe`,
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
  const zipTargetOS = getTargetOS()
  const zipTargetArch = getTargetArch()
  const platformSuffix = IS_ALL ? "" : `-${zipTargetOS}-${zipTargetArch}`
  const zipExt = zipTargetOS === "win32" ? ".zip" : ".tar.gz"
  const zipName = `opencode-offline${platformSuffix}${zipExt}`
  const zipPath = path.join(__dirname, zipName)
  if (fs.existsSync(zipPath)) {
    console.log(`Removing existing ${zipName}...`)
    fs.rmSync(zipPath, { force: true })
  }

  fs.mkdirSync(BUNDLE_DIR, { recursive: true })
  fs.mkdirSync(path.join(BUNDLE_DIR, "bin"), { recursive: true })
  fs.mkdirSync(path.join(BUNDLE_DIR, "node"), { recursive: true })
  fs.mkdirSync(path.join(BUNDLE_DIR, "deps"), { recursive: true })

  // 2. Build Opencode
  const buildTargetMsg = IS_ALL ? "all platforms" : `${getTargetOS()}-${getTargetArch()}`
  console.log(`Building Opencode for ${buildTargetMsg}...`)
  const buildScript = path.join(PROJECT_ROOT, "packages", "opencode", "script", "build.ts")
  if (!fs.existsSync(buildScript)) {
    throw new Error(`Build script not found at: ${buildScript}`)
  }

  if (IS_ALL) {
    await $`bun ${buildScript}`.cwd(PROJECT_ROOT)
  } else {
    await $`bun ${buildScript} --single`.cwd(PROJECT_ROOT)
  }

  // Copy binaries
  console.log("Copying binaries...")
  const distPath = path.join(PROJECT_ROOT, "packages", "opencode", "dist")
  if (!fs.existsSync(distPath)) throw new Error("Build failed: dist folder not found")

  const targets = fs.readdirSync(distPath)
  const currentOS = getTargetOS()
  const currentArch = getTargetArch()
  for (const target of targets) {
    if (!IS_ALL && !target.includes(currentOS)) continue
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
  const targetOS = getTargetOS()
  const targetArch = getTargetArch()
  const filteredNodes = NODES.filter((n) => IS_ALL || (n.platform === targetOS && n.arch === targetArch))
  await Promise.all(
    filteredNodes.map((node) => {
      return downloadFile(node.url, path.join(BUNDLE_DIR, "node", path.basename(node.url)))
    }),
  )

  // 3.1 Download Miniforge (Python 3.12)
  console.log("Downloading Miniforge (Python 3.12)...")
  fs.mkdirSync(path.join(BUNDLE_DIR, "python"), { recursive: true })
  const miniforgePkg = MINIFORGE.find((m) => m.platform === targetOS && m.arch === targetArch)
  if (miniforgePkg) {
    await downloadFile(miniforgePkg.url, path.join(BUNDLE_DIR, "python", miniforgePkg.name))
  } else {
    console.log("Warning: No Miniforge package found for current platform, skipping...")
  }

  // 4. Prepare Dependencies
  console.log("Installing dependencies...")
  const depsPkg = {
    dependencies: {
      "@opencode-ai/plugin": "1.1.36",
      "@openauthjs/openauth": "0.0.0-20250322224806",
      "@gitlab/opencode-gitlab-auth": "1.3.3",
      ...Object.fromEntries(MCP_PACKAGES.map((pkg) => [pkg, "latest"])),
    },
  }
  fs.writeFileSync(path.join(BUNDLE_DIR, "deps", "package.json"), JSON.stringify(depsPkg, null, 2))

  // Create a clean .npmrc to avoid user config issues (e.g. broken proxy settings)
  fs.writeFileSync(path.join(BUNDLE_DIR, "deps", ".npmrc"), "registry=https://registry.npmjs.org/\n")

  // Install deps using npm (so we get a standard node_modules)
  // Use --userconfig to ignore the user's ~/.npmrc which might have invalid proxy settings
  await $`cd ${path.join(BUNDLE_DIR, "deps")} && npm --userconfig=.npmrc install --no-bin-links --ignore-scripts --no-audit --no-fund --omit=dev`

  if (MCP_PACKAGES.some((p) => p.includes("playwright"))) {
    console.log("Installing Playwright browsers...")
    const depsDir = path.join(BUNDLE_DIR, "deps")
    try {
      await $`cd ${depsDir} && npx --yes playwright install --with-deps chromium firefox webkit`.cwd(PROJECT_ROOT)
      console.log("Playwright browsers installed.")
    } catch (e) {
      console.warn("Warning: Failed to install Playwright browsers:", e)
    }
  }

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

  try {
    if (targetOS === "win32") {
      await $`cd ${BUNDLE_DIR} && zip -r ${zipPath} .`
    } else {
      await $`tar -czf ${zipPath} -C ${BUNDLE_DIR} .`
    }
  } catch (error) {
    console.error("Error compressing bundle.")
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
