#!/usr/bin/env bash
# Первичная установка KP-AE на чистый VPS (Debian/Ubuntu).
# Запускать от root. Скрипт идемпотентный — повторный запуск безопасен.
set -euo pipefail

REPO="${REPO:-git@github.com:Denzo17/KP-AE.git}"
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

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo "node $(node -v)"

say "3/8 Шрифты (без них кириллица и ₽ в PDF станут квадратами)"
apt-get install -y -qq fonts-liberation fonts-dejavu-core
fc-match "Times New Roman" || true

say "4/8 Chromium"
# На Ubuntu пакет chromium — обёртка над snap, в headless на сервере она
# часто не стартует. Поэтому системный берём только если это реальный
# бинарник, иначе Chrome ставит сам puppeteer.
CHROMIUM=""
apt-get install -y -qq chromium 2>/dev/null || apt-get install -y -qq chromium-browser 2>/dev/null || true
for candidate in /usr/bin/chromium /usr/bin/chromium-browser; do
  if [ -x "$candidate" ] && ! readlink -f "$candidate" | grep -q snap; then
    CHROMIUM="$candidate"
    break
  fi
done
if [ -n "$CHROMIUM" ]; then
  echo "системный chromium: $CHROMIUM"
else
  echo "системный chromium не годится — Chrome поставит puppeteer на шаге 6"
fi

say "5/8 Пользователь и каталоги"
id kpae >/dev/null 2>&1 || useradd -r -m -d /var/lib/kpae-home -s /usr/sbin/nologin kpae
mkdir -p "$DATA_DIR"
chown -R kpae:kpae "$DATA_DIR"

say "6/8 Код"
if [ ! -d "$APP_DIR/.git" ]; then
  # Приватный репозиторий: нужен deploy key. Генерируем и просим добавить.
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
  git clone "$REPO" "$APP_DIR"
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
