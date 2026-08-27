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

# Обновление puppeteer может потребовать более свежего Chrome, а простая
# проверка «файл на месте» этого не ловит. Пробуем реально запустить, и если
# не выходит — доставляем подходящий браузер прямо здесь.
export CHROMIUM_PATH="$(grep '^CHROMIUM_PATH=' /etc/kp-ae.env | cut -d= -f2-)"
if ! node scripts/check-browser.js; then
  echo "ставлю браузер, подходящий текущей версии puppeteer"
  npx --yes puppeteer browsers install chrome
  SRC="$(find /root/.cache/puppeteer -name chrome -type f -perm -u+x | head -1)"
  if [ -z "$SRC" ]; then
    echo "не удалось поставить браузер — печать PDF работать не будет"
    exit 1
  fi
  rm -rf /opt/chrome
  mkdir -p /opt/chrome
  cp -r /root/.cache/puppeteer/* /opt/chrome/
  chown -R kpae:kpae /opt/chrome
  CHROMIUM_PATH="$(find /opt/chrome -name chrome -type f -perm -u+x | head -1)"
  sed -i "s|^CHROMIUM_PATH=.*|CHROMIUM_PATH=$CHROMIUM_PATH|" /etc/kp-ae.env
  export CHROMIUM_PATH
  node scripts/check-browser.js
  echo "браузер обновлён: $CHROMIUM_PATH"
fi

npm test

chown -R kpae:kpae "$APP_DIR"
systemctl restart kp-ae
sleep 3
curl -fsS "http://127.0.0.1:$PORT/healthz" && echo " — сервис поднялся"
