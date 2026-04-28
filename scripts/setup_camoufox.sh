#!/usr/bin/env bash
set -e

echo "=== Camoufox Setup ==="

# 1. Install system dependencies (Ubuntu/Debian)
if command -v apt-get &>/dev/null; then
  echo "Installing system dependencies..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq \
    libgtk-3-0 libdbus-glib-1-2 libxt6 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libpango-1.0-0 libasound2 \
    2>/dev/null || true
fi

# 2. Install Python package
echo "Installing camoufox Python package..."
python3 -m pip install -r requirements.txt

# 3. Download browser binaries
echo "Downloading camoufox browser binaries..."
python3 -m camoufox fetch

# 4. Ensure uBlock Origin addon is available
# (Mozilla AMO may block automated downloads with 451, so we fall back to GitHub)
UBO_DIR="${HOME}/.cache/camoufox/addons/UBO"
if [ ! -f "${UBO_DIR}/manifest.json" ]; then
  echo "UBO addon missing or incomplete. Downloading from GitHub..."
  rm -rf "${UBO_DIR}"
  mkdir -p "${UBO_DIR}"
  TMP_XPI="/tmp/ublock_origin.xpi"
  curl -sL -o "${TMP_XPI}" \
    "https://github.com/gorhill/uBlock/releases/download/1.70.0/uBlock0_1.70.0.firefox.signed.xpi"
  unzip -q -o "${TMP_XPI}" -d "${UBO_DIR}"
  rm -f "${TMP_XPI}"
  echo "UBO addon installed."
fi

echo "=== Camoufox setup complete ==="
