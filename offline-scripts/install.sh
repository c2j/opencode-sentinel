#!/bin/bash
set -e

# Detect OS and Arch
OS="$(uname -s)"
ARCH="$(uname -m)"
INSTALL_DIR="$(pwd)"
CACHE_DIR=""

echo "--- Opencode Offline Installer ---"
echo "Detected OS: $OS"
echo "Detected Arch: $ARCH"
echo "Note: Assuming package is already unzipped."

# Map to our naming convention
TARGET_OS=""
case "$OS" in
  Linux) TARGET_OS="linux" ;;
  Darwin) TARGET_OS="darwin" ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

TARGET_ARCH=""
case "$ARCH" in
  x86_64) TARGET_ARCH="x64" ;;
  aarch64|arm64) TARGET_ARCH="arm64" ;;
  *) echo "Unsupported Arch: $ARCH"; exit 1 ;;
esac

# 1. Setup Binary
echo "Setting up Opencode binary..."
BIN_NAME="opencode-${TARGET_OS}-${TARGET_ARCH}"
if [ ! -f "$INSTALL_DIR/bin/$BIN_NAME" ]; then
  echo "Error: Binary $BIN_NAME not found in package."
  exit 1
fi

# Make binary executable
chmod +x "$INSTALL_DIR/bin/$BIN_NAME"

# Copy binary to 'opencode' (no suffix) for easier CLI usage
cp "$INSTALL_DIR/bin/$BIN_NAME" "$INSTALL_DIR/bin/opencode"
chmod +x "$INSTALL_DIR/bin/opencode"

# 2. Setup Node.js
echo "Setting up Node.js..."
NODE_ARCHIVE=""
if [ "$TARGET_OS" = "linux" ]; then
  NODE_ARCHIVE=$(find "$INSTALL_DIR/node" -name "node-*-linux-${TARGET_ARCH}.tar.xz" | head -n 1)
elif [ "$TARGET_OS" = "darwin" ]; then
  NODE_ARCHIVE=$(find "$INSTALL_DIR/node" -name "node-*-darwin-${TARGET_ARCH}.tar.gz" | head -n 1)
fi

if [ -z "$NODE_ARCHIVE" ]; then
  echo "Warning: Node.js archive for ${TARGET_OS}-${TARGET_ARCH} not found. Opencode might not work correctly without Node.js."
else
  # Check if already extracted
  if [ ! -d "$INSTALL_DIR/node/bin" ]; then
      echo "Extracting $NODE_ARCHIVE..."
      # Extract to a temporary directory first
      TEMP_NODE="$INSTALL_DIR/node_temp"
      mkdir -p "$TEMP_NODE"
      tar -xf "$NODE_ARCHIVE" -C "$TEMP_NODE"
      # Move contents to $INSTALL_DIR/node (standardizing structure)
      # We assume the tarball contains a single root folder like node-v20.11.0-linux-x64
      EXTRACTED_DIR=$(find "$TEMP_NODE" -maxdepth 1 -type d -name "node-v*" | head -n 1)
      if [ -n "$EXTRACTED_DIR" ]; then
          # Move contents of extracted dir to INSTALL_DIR/node (overwriting/merging)
          cp -r "$EXTRACTED_DIR/"* "$INSTALL_DIR/node/"
          rm -rf "$TEMP_NODE"
      fi
  fi
fi

# 3. Setup Cache
echo "Setting up Cache..."
if [ "$TARGET_OS" = "linux" ]; then
  CACHE_DIR="$HOME/.cache/opencode"
  CONFIG_DIR="$HOME/.config/opencode"
elif [ "$TARGET_OS" = "darwin" ]; then
  CACHE_DIR="$HOME/Library/Caches/opencode"
  CONFIG_DIR="$HOME/Library/Application Support/opencode"
fi

# Setup Cache Directory
echo "Cache Directory: $CACHE_DIR"
mkdir -p "$CACHE_DIR"
cp "$INSTALL_DIR/deps/package.json" "$CACHE_DIR/"
echo "Installing plugins to cache..."
rm -rf "$CACHE_DIR/node_modules"
cp -r "$INSTALL_DIR/deps/node_modules" "$CACHE_DIR/"

# Setup Config Directory (Duplicate dependencies here to prevent sticking)
echo "Config Directory: $CONFIG_DIR"
mkdir -p "$CONFIG_DIR"
cp "$INSTALL_DIR/deps/package.json" "$CONFIG_DIR/"
echo "Installing plugins to config dir..."
rm -rf "$CONFIG_DIR/node_modules"
cp -r "$INSTALL_DIR/deps/node_modules" "$CONFIG_DIR/"

# 4. Setup Environment Variables
echo "Setting up Environment Variables..."

SHELL_CONFIG=""
case "$SHELL" in
  */bash)
    if [ -f "$HOME/.bashrc" ]; then SHELL_CONFIG="$HOME/.bashrc";
    elif [ -f "$HOME/.bash_profile" ]; then SHELL_CONFIG="$HOME/.bash_profile";
    else SHELL_CONFIG="$HOME/.bashrc"; fi
    ;;
  */zsh)
    SHELL_CONFIG="$HOME/.zshrc"
    ;;
  *)
    echo "Warning: Unsupported shell $SHELL. Please manually add Node.js and Opencode to your PATH."
    ;;
esac

if [ -n "$SHELL_CONFIG" ]; then
  # Remove old entries if they exist
  sed -i.bak '/# Opencode Path/d' "$SHELL_CONFIG"
  sed -i.bak "/export PATH=.*opencode.*node\/bin/d" "$SHELL_CONFIG"

  # Add new entries
  echo "" >> "$SHELL_CONFIG"
  echo "# Opencode Path" >> "$SHELL_CONFIG"
  echo "export PATH=\"$INSTALL_DIR/node/bin:$INSTALL_DIR/bin:\$PATH\"" >> "$SHELL_CONFIG"

  echo "Added Opencode and Node.js to PATH in $SHELL_CONFIG"
  echo "Please run 'source $SHELL_CONFIG' or restart your terminal to apply changes."
fi

echo ""
echo "--- Installation Complete ---"
echo "You can run Opencode using: $BIN_NAME"
