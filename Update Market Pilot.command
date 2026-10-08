#!/bin/bash
cd "$(dirname "$0")"
node setup/update.mjs
echo ""
echo "Press Enter to close this window."
read -r _
