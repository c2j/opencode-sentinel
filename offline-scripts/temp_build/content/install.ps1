# offline-scripts/install.ps1
$ErrorActionPreference = "Stop"

Write-Host "--- Opencode Offline Installer (Windows) ---"
Write-Host "Note: Assuming package is already unzipped."

$InstallDir = $PSScriptRoot

# 1. Setup Binary
Write-Host "Setting up Opencode binary..."
# pack.ts renames binaries to match the build target name (e.g. opencode-windows-x64.exe)
$BinName = "opencode-windows-x64.exe"
$SourceBin = Join-Path $InstallDir "bin\$BinName"

if (-not (Test-Path $SourceBin)) {
    # Fallback check
    $SourceBin = Get-ChildItem "$InstallDir\bin\opencode-*.exe" | Select-Object -First 1
}

if (-not $SourceBin) {
    Write-Error "Error: Opencode binary not found in package."
}

# Copy binary to 'opencode.exe' (no suffix) for easier CLI usage
Copy-Item $SourceBin "$InstallDir\bin\opencode.exe" -Force

# 2. Setup Node.js
Write-Host "Setting up Node.js..."
$NodeZip = Get-ChildItem "$InstallDir\node\node-*-win-x64.zip" | Select-Object -First 1

if ($NodeZip) {
    # Check if 'node' directory already has content (e.g. node.exe)
    if (-not (Test-Path "$InstallDir\node\node.exe")) {
        Write-Host "Extracting $($NodeZip.Name)..."
        # Extract to temp
        $TempNode = Join-Path $InstallDir "node_temp"
        Expand-Archive -Path $NodeZip.FullName -DestinationPath $TempNode -Force

        # Move content to node dir
        $ExtractedNode = Get-ChildItem $TempNode | Where-Object { $_.Name -like "node-v*-win-x64" }
        if ($ExtractedNode) {
            Get-ChildItem $ExtractedNode.FullName | Move-Item -Destination "$InstallDir\node" -Force
        }
        Remove-Item $TempNode -Recurse -Force
    }
} else {
    Write-Warning "Node.js archive not found. Opencode might not work correctly."
}

# 2.1 Setup Python (Miniforge)
Write-Host "Setting up Python (Miniforge)..."
$MiniforgeInstaller = Get-ChildItem "$InstallDir\python\Miniforge3-*-Windows-x86_64.exe" | Select-Object -First 1

if ($MiniforgeInstaller) {
    Write-Host "Installing Miniforge from $($MiniforgeInstaller.Name)..."
    # Install silently to local directory
    $PythonDir = Join-Path $InstallDir "python\conda"
    Start-Process -FilePath $MiniforgeInstaller.FullName -ArgumentList "/S", "/D=$PythonDir" -Wait
    Write-Host "Miniforge installed to $PythonDir"
} else {
    Write-Warning "Miniforge installer not found. Python will not be available."
}

# 3. Setup Cache and Config
Write-Host "Setting up Cache and Config..."

# Setup Cache: %LOCALAPPDATA%\opencode
$CacheDir = Join-Path $env:LOCALAPPDATA "opencode"
if (-not (Test-Path $CacheDir)) {
    New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null
}

Write-Host "Cache Directory: $CacheDir"
Copy-Item (Join-Path $InstallDir "deps\package.json") $CacheDir -Force

Write-Host "Installing plugins to cache..."
$DestNodeModules = Join-Path $CacheDir "node_modules"
if (Test-Path $DestNodeModules) {
    Remove-Item $DestNodeModules -Recurse -Force
}
Copy-Item (Join-Path $InstallDir "deps\node_modules") $CacheDir -Recurse -Force

# Setup Config: %APPDATA%\opencode (Roaming)
$ConfigDir = Join-Path $env:APPDATA "opencode"
if (-not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
}

Write-Host "Config Directory: $ConfigDir"
Copy-Item (Join-Path $InstallDir "deps\package.json") $ConfigDir -Force

Write-Host "Installing plugins to config dir..."
$DestConfigNodeModules = Join-Path $ConfigDir "node_modules"
if (Test-Path $DestConfigNodeModules) {
    Remove-Item $DestConfigNodeModules -Recurse -Force
}
Copy-Item (Join-Path $InstallDir "deps\node_modules") $ConfigDir -Recurse -Force

# Setup Playwright browsers
$PlaywrightModule = Join-Path $InstallDir "deps\node_modules\playwright"
if (Test-Path $PlaywrightModule) {
    Write-Host "Setting up Playwright browsers..."
    $PlaywrightBrowsers = Join-Path $env:LOCALAPPDATA "ms-playwright"
    if (-not (Test-Path $PlaywrightBrowsers)) {
        New-Item -ItemType Directory -Path $PlaywrightBrowsers -Force | Out-Null
    }
    $LocalBrowsers = Join-Path $PlaywrightModule ".local-browsers"
    if (Test-Path $LocalBrowsers) {
        Copy-Item "$LocalBrowsers\*" $PlaywrightBrowsers -Recurse -Force
        Write-Host "Playwright browsers copied to $PlaywrightBrowsers"
    } else {
        Write-Warning "Playwright browsers not found in package."
    }
}

# 4. Setup Environment Variables (User Level)
Write-Host "Setting up Environment Variables..."
$NodePath = Join-Path $InstallDir "node"
$BinPath = Join-Path $InstallDir "bin"
$PythonPath = Join-Path $InstallDir "python\conda"

$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
$NewPath = $CurrentPath

# Add Python path if not present
if ($CurrentPath -notlike "*$PythonPath*" -and (Test-Path $PythonPath)) {
    $NewPath = "$PythonPath;$NewPath"
}
# Add Node path if not present
if ($CurrentPath -notlike "*$NodePath*") {
    $NewPath = "$NodePath;$NewPath"
}
# Add Bin path if not present
if ($CurrentPath -notlike "*$BinPath*") {
    $NewPath = "$BinPath;$NewPath"
}

if ($NewPath -ne $CurrentPath) {
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    Write-Host "Added Opencode, Node.js and Python to User Path."
    Write-Host "Please restart your terminal (or log off and on) to apply changes."
} else {
    Write-Host "Path already configured."
}

Write-Host ""
Write-Host "--- Installation Complete ---"
Write-Host "You can run Opencode using: $BinName"
