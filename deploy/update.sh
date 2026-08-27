#!/usr/bin/env bash
# Обновление уже развёрнутого приложения.
set -euo pipefail

cd /opt/kp-ae
git pull --ff-only
PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev
npm test
sudo systemctl restart kp-ae
sleep 2
curl -fsS http://127.0.0.1:3000/healthz && echo " — сервис поднялся"
