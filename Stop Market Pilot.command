#!/bin/bash
cd "$(dirname "$0")"
node setup/stop.mjs
echo ""
echo "Press Enter to close this window."
read -r _
