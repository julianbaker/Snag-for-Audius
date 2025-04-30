#!/bin/bash

# Clean dist directory
rm -rf dist
mkdir -p dist/services

# Copy static files
cp manifest.json dist/
cp -r icons dist/
cp -r lib dist/

# Copy popup files
cp popup.html dist/
cp popup.js dist/

# Copy JavaScript files
cp background.js dist/
cp services/*.js dist/services/
cp content.js dist/

# Make the script executable
chmod +x build.sh 