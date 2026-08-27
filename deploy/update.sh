#!/usr/bin/env bash
# Обновление уже развёрнутого приложения. Запускать от root.
set -euo pipefail

APP_DIR=/opt/kp-ae
PORT="$(grep '^PORT=' /etc/kp-ae.env | cut -d= -f2- || echo 3000)"

cd "$APP_DIR"

# Каталог принадлежит kpae, а обновление идёт от root — git по умолчанию
# отказывается работать с «чужим» репозиторием. Разрешаем точечно, без
# записи в глобальный конфиг.
git -c safe.directory="$APP_DIR" pull --ff-only

# Браузер уже лежит по пути из CHROMIUM_PATH и переживает обновления,
# поэтому качать его заново при каждом деплое незачем — это ~150 МБ.
PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev

CHROME="$(grep '^CHROMIUM_PATH=' /etc/kp-ae.env | cut -d= -f2-)"
if [ ! -x "$CHROME" ]; then
  echo "ВНИМАНИЕ: браузер по пути $CHROME не найден, PDF работать не будет."
fi

npm test

chown -R kpae:kpae "$APP_DIR"
systemctl restart kp-ae
sleep 3
curl -fsS "http://127.0.0.1:$PORT/healthz" && echo " — сервис поднялся"
