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

echo "🚀 Starting build process..."

# Clean dist directory
echo "🧹 Cleaning dist directory..."
rm -rf dist || handle_error "Failed to clean dist directory"
mkdir -p dist/services || handle_error "Failed to create dist/services directory"

# Copy static files
echo "📦 Copying static files..."
cp manifest.json dist/ || handle_error "Failed to copy manifest.json"
cp -r icons dist/ || handle_error "Failed to copy icons"
cp -r lib dist/ || handle_error "Failed to copy lib"

# Copy popup files
echo "📄 Copying popup files..."
cp src/popup.html dist/ || handle_error "Failed to copy popup.html"
cp src/popup.js dist/ || handle_error "Failed to copy popup.js"

# Copy JavaScript files
echo "📝 Copying JavaScript files..."
cp src/background.js dist/ || handle_error "Failed to copy background.js"
cp services/*.js dist/services/ || handle_error "Failed to copy service files"
cp src/content.js dist/ || handle_error "Failed to copy content.js"

# Make the script executable
chmod +x build.sh || handle_error "Failed to make build.sh executable"

print_status "success" "Build completed successfully! 🎉" 