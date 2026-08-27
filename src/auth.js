import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

// Доступ к форме и к API закрыт паролем, а страница счёта и PDF остаются
// открытыми: ссылку отправляют клиенту, и он не должен ничего вводить.
// Защита ссылки — в неподбираемом идентификаторе (12 hex-символов).

const PUBLIC_PATHS = [/^\/i\/[0-9a-f]{12}(\.pdf)?$/, /^\/healthz$/];

function isPublic(path) {
  return PUBLIC_PATHS.some((re) => re.test(path));
}

// Сравнение постоянного времени: обычное === выдаёт длину и позицию
// первого несовпавшего символа по времени ответа.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function parseBasic(header) {
  const match = /^Basic\s+(.+)$/i.exec(header || '');
  if (!match) {
    return null;
  }
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) {
    return null;
  }
  return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

export function authMiddleware(req, res, next) {
  if (config.auth.disabled || isPublic(req.path)) {
    return next();
  }

  const credentials = parseBasic(req.headers.authorization);
  const ok = credentials &&
    safeEqual(credentials.user, config.auth.user) &&
    safeEqual(credentials.password, config.auth.password);

  if (!ok) {
    res.setHeader('WWW-Authenticate', 'Basic realm="KP-AE", charset="UTF-8"');
    return res.status(401).send('Требуется авторизация');
  }
  return next();
}

// Без пароля приложение на публичном домене отдаёт все счета кому угодно,
// поэтому старт без него возможен только явным AUTH_DISABLED=1.
export function assertAuthConfigured() {
  if (config.auth.disabled) {
    console.warn('ВНИМАНИЕ: авторизация отключена (AUTH_DISABLED=1). Только для локальной разработки.');
    return;
  }
  if (!config.auth.password) {
    throw new Error(
      'Не задан AUTH_PASSWORD. Без него форма и список счетов открыты всем.\n' +
      'Задайте AUTH_USER и AUTH_PASSWORD, либо AUTH_DISABLED=1 для локального запуска.'
    );
  }
}
