#!/usr/bin/env bash
# 本地交叉编译 linux amd64/arm64 并打包部署用 tar.gz
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
rm -rf dist
mkdir -p dist

echo "[1/3] 编译 linux/amd64..."
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -ldflags="-s -w" -o dist/h2o-agent-linux-amd64 .

echo "[2/3] 编译 linux/arm64..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 \
  go build -trimpath -ldflags="-s -w" -o dist/h2o-agent-linux-arm64 .

echo "[3/3] 打包..."
cp install.sh config.example.json README.md dist/
tar -C dist -czf dist/h2o-agent-bundle.tar.gz \
  h2o-agent-linux-amd64 h2o-agent-linux-arm64 install.sh config.example.json README.md

echo ""
echo "产物列表："
ls -lh dist/
echo ""
echo "部署步骤："
echo "  scp dist/h2o-agent-bundle.tar.gz root@<node>:/tmp/"
echo "  ssh root@<node> 'cd /tmp && mkdir -p h2o-agent && tar xzf h2o-agent-bundle.tar.gz -C h2o-agent && cd h2o-agent && bash install.sh'"
