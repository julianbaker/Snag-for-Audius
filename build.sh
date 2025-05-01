#!/bin/bash

# Clean dist directory
rm -rf dist
mkdir -p dist/services

# Copy static files
cp manifest.json dist/
cp -r icons dist/
cp -r lib dist/

# Copy popup files
cp src/popup.html dist/
cp src/popup.js dist/

# Copy JavaScript files
cp src/background.js dist/
cp services/*.js dist/services/
cp src/content.js dist/

# Make the script executable
chmod +x build.sh 