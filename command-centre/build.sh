#!/bin/sh
# Bundle the mobile app (Meshtastic JS + QR libs) into one offline file: app/app.js
cd "$(dirname "$0")"
npx esbuild app/src/mapview.js --bundle --minify --format=iife --global-name=MedMapLib --outfile=base/static/mapview.js && npx esbuild app/src/main.js --bundle --minify --format=iife --target=es2020 --outfile=app/app.js \
  --alias:os=./app/src/shims/node.js --alias:path=./app/src/shims/node.js --alias:util=./app/src/shims/node.js --inject:./app/src/shims/process.js
