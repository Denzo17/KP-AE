#!/usr/bin/env bash
# Первичная установка KP-AE на чистый VPS (Debian/Ubuntu).
# Запускать от root. Скрипт идемпотентный — повторный запуск безопасен.
set -euo pipefail

REPO="${REPO:-https://github.com/Denzo17/KP-AE.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/kp-ae
DATA_DIR=/var/lib/kp-ae
ENV_FILE=/etc/kp-ae.env
PORT="${PORT:-3000}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1/8 Подкачка"
# На 2 ГБ RAM chromium при печати может упереться в потолок. Swap дешевле,
# чем упавший из-за OOM сервис.
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "swap 2 ГБ подключён"
else
  echo "swap уже есть, пропускаю"
fi

say "2/8 Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx ca-certificates openssh-client

node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' || echo 0; }

# Свежие Ubuntu уже везут Node 22+, и репозиторий NodeSource может не иметь
# сборки под совсем новый релиз. Поэтому сначала штатный пакет.
if [ "$(node_major)" -lt 20 ]; then
  apt-get install -y -qq nodejs npm || true
fi
if [ "$(node_major)" -lt 20 ]; then
  echo "штатный пакет не подошёл, ставлю из NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
[ "$(node_major)" -ge 20 ] || { echo "не удалось поставить Node 20+"; exit 1; }
echo "node $(node -v), npm $(npm -v)"

say "3/8 Шрифты (без них кириллица и ₽ в PDF станут квадратами)"
apt-get install -y -qq fonts-liberation fonts-dejavu-core
fc-match "Times New Roman" || true

say "4/8 Chromium"
# На Ubuntu пакет chromium — обёртка над snap, в headless на сервере она
# часто не стартует. Поэтому системный берём только если это реальный
# бинарник, иначе Chrome ставит сам puppeteer.
CHROMIUM=""
. /etc/os-release

# Ставим по одному: имена библиотек между релизами меняются (libasound2 стал
# libasound2t64 и т.п.), и один отсутствующий пакет не должен ронять установку.
install_optional() {
  for pkg in "$@"; do
    apt-get install -y -qq "$pkg" 2>/dev/null || true
  done
}

if [ "${ID:-}" = "ubuntu" ]; then
  # В Ubuntu пакет chromium — обёртка над snap: в headless на сервере она
  # обычно не стартует. Не тратим время, Chrome поставит puppeteer.
  echo "Ubuntu ${VERSION_ID:-}: системный chromium пропускаю, будет Chrome от puppeteer"
else
  apt-get install -y -qq chromium 2>/dev/null || apt-get install -y -qq chromium-browser 2>/dev/null || true
  for candidate in /usr/bin/chromium /usr/bin/chromium-browser; do
    if [ -x "$candidate" ] && ! readlink -f "$candidate" | grep -q snap; then
      CHROMIUM="$candidate"
      break
    fi
  done
  [ -n "$CHROMIUM" ] && echo "системный chromium: $CHROMIUM"
fi

if [ -z "$CHROMIUM" ]; then
  # Chrome от puppeteer — это только бинарник, системные библиотеки к нему
  # нужны отдельно, иначе он падает с невнятной ошибкой при первом запуске.
  echo "ставлю библиотеки, нужные Chrome"
  install_optional \
    libnss3 libnspr4 libatk1.0-0t64 libatk1.0-0 libatk-bridge2.0-0t64 libatk-bridge2.0-0 \
    libcups2t64 libcups2 libdrm2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libasound2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxext6 libx11-6 \
    libxcb1 libglib2.0-0t64 libglib2.0-0 libdbus-1-3 libexpat1 libudev1
fi

say "5/8 Пользователь и каталоги"
id kpae >/dev/null 2>&1 || useradd -r -m -d /var/lib/kpae-home -s /usr/sbin/nologin kpae
mkdir -p "$DATA_DIR"
chown -R kpae:kpae "$DATA_DIR"

say "6/8 Код"
if [ ! -d "$APP_DIR/.git" ]; then
  # Публичный репозиторий по HTTPS: авторизация не нужна вовсе.
  if [ "${REPO#https://}" != "$REPO" ]; then
    git clone -b "$BRANCH" "$REPO" "$APP_DIR"
  else
  # Приватный репозиторий по SSH: нужен deploy key. Генерируем и просим добавить.
  if [ ! -f /root/.ssh/kp_ae_deploy ]; then
    mkdir -p /root/.ssh
    ssh-keygen -t ed25519 -N '' -f /root/.ssh/kp_ae_deploy -C 'kp-ae-deploy' >/dev/null
    cat >> /root/.ssh/config <<EOF
Host github.com
  IdentityFile /root/.ssh/kp_ae_deploy
  IdentitiesOnly yes
EOF
  fi
  if ! ssh -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
    echo
    echo "НУЖЕН ОДИН РУЧНОЙ ШАГ."
    echo "Открой https://github.com/Denzo17/KP-AE/settings/keys/new"
    echo "и добавь этот ключ (Allow write access НЕ нужен):"
    echo
    cat /root/.ssh/kp_ae_deploy.pub
    echo
    echo "После этого запусти скрипт ещё раз — он продолжит с этого места."
    exit 0
  fi
    git clone -b "$BRANCH" "$REPO" "$APP_DIR"
  fi
fi

cd "$APP_DIR"
git pull --ff-only || true

if [ -n "$CHROMIUM" ]; then
  PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev
else
  npm ci --omit=dev
  npx puppeteer browsers install chrome
  CHROMIUM="$(find /root/.cache/puppeteer -name chrome -type f -perm -u+x | head -1)"
  echo "Chrome от puppeteer: $CHROMIUM"
fi

npm test

say "7/8 Настройки"
if [ ! -f "$ENV_FILE" ]; then
  PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"
  IP="$(curl -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
  cat > "$ENV_FILE" <<EOF
PORT=$PORT
BASE_URL=http://$IP
DATA_DIR=$DATA_DIR
CHROMIUM_PATH=$CHROMIUM
AUTH_USER=manager
AUTH_PASSWORD=$PASSWORD
EOF
  chmod 600 "$ENV_FILE"
  chown kpae:kpae "$ENV_FILE"
  echo "Создан $ENV_FILE"
else
  # Путь до chromium мог измениться — обновляем, остальное не трогаем.
  sed -i "s|^CHROMIUM_PATH=.*|CHROMIUM_PATH=$CHROMIUM|" "$ENV_FILE"
  echo "$ENV_FILE уже есть, обновил только CHROMIUM_PATH"
fi

# Chrome от puppeteer лежит в /root/.cache — сервису под kpae туда не попасть.
if echo "$CHROMIUM" | grep -q '^/root/'; then
  mkdir -p /opt/chrome
  cp -r /root/.cache/puppeteer/* /opt/chrome/
  NEW="$(find /opt/chrome -name chrome -type f -perm -u+x | head -1)"
  chown -R kpae:kpae /opt/chrome
  sed -i "s|^CHROMIUM_PATH=.*|CHROMIUM_PATH=$NEW|" "$ENV_FILE"
  echo "Chrome перенесён в $NEW"
fi

chown -R kpae:kpae "$APP_DIR"

say "8/8 Сервис и nginx"
cp deploy/kp-ae.service /etc/systemd/system/
# Chrome вне /var/lib требует доступа на запись во временные профили.
systemctl daemon-reload
systemctl enable --now kp-ae
sleep 3
systemctl is-active --quiet kp-ae && echo "сервис запущен" || { journalctl -u kp-ae -n 30 --no-pager; exit 1; }

# Пока домена нет — отдаём по IP на 80-м порту, без SSL.
cat > /etc/nginx/sites-available/kp-ae <<EOF
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 4m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/kp-ae /etc/nginx/sites-enabled/kp-ae
nginx -t && systemctl reload nginx

say "Готово"
curl -fsS "http://127.0.0.1:$PORT/healthz" && echo
echo
echo "Адрес:  $(grep '^BASE_URL=' $ENV_FILE | cut -d= -f2-)"
echo "Логин:  $(grep '^AUTH_USER=' $ENV_FILE | cut -d= -f2-)"
echo "Пароль: $(grep '^AUTH_PASSWORD=' $ENV_FILE | cut -d= -f2-)"
echo
echo "Дальше: смени пароль root (passwd) и настрой вход по ключу."
echo "Когда появится домен — certbot и HTTPS, инструкция в README."
