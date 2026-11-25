#!/bin/sh
set -eu
cd "$(dirname "$0")"
tar -xzf frontend-source.tar.gz
cd frontend
printf 'NODE_ENV=production\n' > .env.production
npm ci
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack
cd ..
cp -R frontend/out/. runtime-source/ui-out/
docker buildx build --platform linux/arm64 -f runtime-source/Dockerfile.runtime -t realai/gateway:1.0.10-arm64 --load runtime-source
cd motor-source
tar -xzf source.tar.gz
docker buildx build --platform linux/arm64 -f Dockerfile.native-arm64 -t realai/motor-native:3.2.0-arm64 --load .
docker buildx build --platform linux/arm64 -f Dockerfile.arm64 -t realai/motor:3.2.0-runtime-arm64 --load .
