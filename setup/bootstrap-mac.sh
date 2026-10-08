#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v brew >/dev/null 2>&1; then
  echo ""
  echo "Installing Homebrew. macOS will ask for your password."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi

echo ""
echo "Installing Node.js and Python if they are missing."
brew install node python@3.11

if [[ -x "$(brew --prefix python@3.11)/bin/python3.11" ]]; then
  export PATH="$(brew --prefix python@3.11)/bin:$PATH"
fi

echo ""
echo "Installing the setup tools."
npm install --prefix setup

exec node setup/wizard.mjs
