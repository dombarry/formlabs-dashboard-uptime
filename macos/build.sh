#!/bin/bash
# Builds a universal DashboardStatus.app and a zip to hand out.
# Usage: STATUS_PAGE_URL=https://your-app.vercel.app ./build.sh
set -euo pipefail
cd "$(dirname "$0")"

STATUS_PAGE_URL="${STATUS_PAGE_URL:-https://formlabs-dashboard-uptime.vercel.app}"
VERSION="${VERSION:-1.0}"
APP="dist/Dashboard Status.app"

# Plain swiftc rather than `swift build` so this works with just the Command Line Tools
# Override SDKROOT if your compiler and default SDK don't match (e.g. a half-updated CLT install)
SDK="${SDKROOT:-$(xcrun --show-sdk-path)}"
mkdir -p .build
for arch in arm64 x86_64; do
  swiftc -O -parse-as-library -sdk "$SDK" -target "$arch-apple-macos13.0" \
    Sources/DashboardStatus/*.swift -o ".build/DashboardStatus-$arch"
done

rm -rf dist && mkdir -p "$APP/Contents/MacOS"
lipo -create -output "$APP/Contents/MacOS/DashboardStatus" \
  .build/DashboardStatus-arm64 .build/DashboardStatus-x86_64

# LSUIElement hides the Dock icon so it lives only in the menu bar
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.formlabs.dashboard-status</string>
  <key>CFBundleName</key><string>Dashboard Status</string>
  <key>CFBundleDisplayName</key><string>Dashboard Status</string>
  <key>CFBundleExecutable</key><string>DashboardStatus</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>StatusPageURL</key><string>$STATUS_PAGE_URL</string>
</dict>
</plist>
PLIST

# Ad-hoc signature; swap "-" for a "Developer ID Application: ..." identity (and notarize) for a warning-free install
codesign --force --deep --sign "${SIGN_IDENTITY:--}" "$APP"

ditto -c -k --keepParent "$APP" "dist/DashboardStatus.zip"
echo "Built $APP and dist/DashboardStatus.zip (status URL: $STATUS_PAGE_URL)"
