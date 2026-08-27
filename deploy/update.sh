#!/usr/bin/env bash
# Обновление уже развёрнутого приложения. Запускать от root.
set -euo pipefail

APP_DIR=/opt/kp-ae
PORT="$(grep '^PORT=' /etc/kp-ae.env | cut -d= -f2- || echo 3000)"

cd "$APP_DIR"
git pull --ff-only

if grep -q '^CHROMIUM_PATH=/opt/chrome' /etc/kp-ae.env; then
  npm ci --omit=dev
else
  PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev
fi

npm test

chown -R kpae:kpae "$APP_DIR"
systemctl restart kp-ae
sleep 3
curl -fsS "http://127.0.0.1:$PORT/healthz" && echo " — сервис поднялся"
