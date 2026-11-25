#!/bin/bash
# Usage: verify_apk.sh <apk>
# Prints package/version/permissions, signer certificate and bundled web files.
set -euo pipefail
apk="${1:?apk path}"
bt=$(ls -d /opt/android-sdk/build-tools/* | sort -V | tail -1)

echo "== package"
"$bt/aapt2" dump badging "$apk" | grep -E "^package|application-label:|sdkVersion|targetSdkVersion"
echo "== permissions"
"$bt/aapt2" dump badging "$apk" | grep "uses-permission" | sed "s/uses-permission: name=//"
echo "== signer"
"$bt/apksigner" verify --print-certs "$apk" | grep -E "certificate (DN|SHA-256)"
echo "== web files"
n=$(unzip -l "$apk" | grep -c "assets/web/" || true)
echo "$n files under assets/web/"
[ "$n" -gt 0 ] || { echo "ERROR: web UI missing - run npm run build:android"; exit 1; }
ls -la "$apk" | awk '{print "size:", $5, "bytes"}'
