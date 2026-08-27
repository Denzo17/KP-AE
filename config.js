import { fileURLToPath } from 'node:url';

// Всё, что меняется при переезде между хостингами и аккаунтами, живёт здесь.
// В коде не должно быть ни одного захардкоженного адреса или пути.
export const config = {
  port: Number(process.env.PORT || 3000),

  // Внешний адрес сайта. Именно он подставляется в ссылки на КП,
  // поэтому при переезде на другой домен/аккаунт меняется только эта строка.
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),

  // Каталог хранения КП. На Beget VPS удобно вынести за пределы каталога с
  // кодом, чтобы деплой не затирал данные: DATA_DIR=/var/lib/kp-ae.
  dataDir: process.env.DATA_DIR || fileURLToPath(new URL('./data', import.meta.url)),

  // Puppeteer на VPS обычно ходит в системный chromium, чтобы не тащить
  // свою копию при каждом деплое: CHROMIUM_PATH=/usr/bin/chromium.
  chromiumPath: process.env.CHROMIUM_PATH || null,

  // Доступ к форме и API. Страница счёта и PDF остаются публичными —
  // по ссылке их открывает клиент.
  auth: {
    user: process.env.AUTH_USER || 'manager',
    password: process.env.AUTH_PASSWORD || '',
    disabled: process.env.AUTH_DISABLED === '1'
  },

  // Битрикс24: подключения пока нет, заложена только точка входа.
  bitrix: {
    enabled: process.env.BITRIX_ENABLED === '1',
    webhookUrl: process.env.BITRIX_WEBHOOK_URL || ''
  }
};
