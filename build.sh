#!/bin/bash

# Function to print colored output
print_status() {
    if [ "$1" = "success" ]; then
        echo -e "\033[32m✓ $2\033[0m"
    else
        echo -e "\033[31m✗ $2\033[0m"
    fi
}

# Function to handle errors
handle_error() {
    print_status "error" "Build failed: $1"
    exit 1
}

# Read version information
VERSION=$(jq -r '.version' version.json)
BUILD=$(jq -r '.build' version.json)
CURRENT_DIR="dist/current"
EXT_DIR="$CURRENT_DIR/extension"
ZIP_NAME="snag-for-audius-v${VERSION}.zip"
ZIP_PATH="dist/$ZIP_NAME"
INSTALL_GUIDE="docs/INSTALLATION.txt"

# Clean up previous build
rm -rf "$CURRENT_DIR"
mkdir -p "$EXT_DIR/services" || handle_error "Failed to create build directory"

# Copy extension files
cp manifest.json "$EXT_DIR/" || handle_error "Failed to copy manifest.json"
cp -r icons "$EXT_DIR/" || handle_error "Failed to copy icons"
cp -r lib "$EXT_DIR/" || handle_error "Failed to copy lib"
cp src/popup.html "$EXT_DIR/" || handle_error "Failed to copy popup.html"
cp src/popup.js "$EXT_DIR/" || handle_error "Failed to copy popup.js"
cp src/background.js "$EXT_DIR/" || handle_error "Failed to copy background.js"
cp services/*.js "$EXT_DIR/services/" || handle_error "Failed to copy service files"
cp src/content.js "$EXT_DIR/" || handle_error "Failed to copy content.js"

# Copy installation guide
cp "$INSTALL_GUIDE" "$CURRENT_DIR/" || handle_error "Failed to copy installation guide"

# Update manifest version
jq --arg version "$VERSION" '.version = $version' "$EXT_DIR/manifest.json" > "$EXT_DIR/manifest.tmp"
mv "$EXT_DIR/manifest.tmp" "$EXT_DIR/manifest.json"

# Remove any existing zip for this version
rm -f "$ZIP_PATH"

# Create the zip archive (so the top-level folder is named after the version)
cd dist || handle_error "Failed to enter dist directory"
cp -R current "snag-for-audius-v${VERSION}" || handle_error "Failed to copy for zipping"
zip -r "$ZIP_NAME" "snag-for-audius-v${VERSION}" > /dev/null || handle_error "Failed to create ZIP archive"
rm -rf "snag-for-audius-v${VERSION}"
cd ..

# Increment build number
jq --argjson new_build $((BUILD + 1)) '.build = $new_build' version.json > version.tmp
mv version.tmp version.json

print_status "success" "Build completed successfully! 🎉"
print_status "success" "Current build: $CURRENT_DIR"
print_status "success" "ZIP archive: $ZIP_PATH"
print_status "success" "Build number: $BUILD" 