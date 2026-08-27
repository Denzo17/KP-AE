import { config } from '../config.js';
import { authenticate } from './users.js';

// Доступ к форме и к API закрыт паролем, а страница счёта и PDF остаются
// открытыми: ссылку отправляют клиенту, и он не должен ничего вводить.
// Защита ссылки — в неподбираемом идентификаторе.

const PUBLIC_PATHS = [/^\/i\/[0-9a-f]{12}(\.pdf)?$/, /^\/healthz$/];

function isPublic(path) {
  return PUBLIC_PATHS.some((re) => re.test(path));
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

// Ограничение перебора: пароль в HTTP Basic можно подбирать бесконечно
// быстро, поэтому считаем неудачные попытки по адресу и временно закрываем
// доступ. Счётчик в памяти — при перезапуске обнуляется, для сервиса на
// несколько человек этого достаточно.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map();

// Считаем неудачи по паре «адрес + логин», а не по одному адресу: в офисе
// с общим выходом в интернет иначе один человек, забывший пароль, закрыл бы
// вход всем коллегам. Перебор одной учётки при этом всё равно упирается в
// лимит.
function clientKey(req, login) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `${ip}|${String(login || '').toLowerCase()}`;
}

function isBlocked(key) {
  const entry = failures.get(key);
  if (!entry) {
    return false;
  }
  if (Date.now() > entry.until) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function noteFailure(key) {
  const entry = failures.get(key);
  if (!entry || Date.now() > entry.until) {
    failures.set(key, { count: 1, until: Date.now() + WINDOW_MS });
    return;
  }
  entry.count += 1;
  entry.until = Date.now() + WINDOW_MS;
}

function noteSuccess(key) {
  failures.delete(key);
}

function requestAuth(res) {
  res.setHeader('WWW-Authenticate', 'Basic realm="KP-AE", charset="UTF-8"');
  return res.status(401).send('Требуется авторизация');
}

export function authMiddleware(req, res, next) {
  if (isPublic(req.path)) {
    return next();
  }
  if (config.auth.disabled) {
    req.user = { login: 'dev', name: 'Разработка', role: 'admin' };
    return next();
  }

  const credentials = parseBasic(req.headers.authorization);
  if (!credentials) {
    return requestAuth(res);
  }

  const key = clientKey(req, credentials.user);
  if (isBlocked(key)) {
    return res.status(429).send('Слишком много неудачных попыток входа. Повторите через 15 минут.');
  }

  authenticate(credentials.user, credentials.password)
    .then((user) => {
      if (!user) {
        noteFailure(key);
        return requestAuth(res);
      }
      noteSuccess(key);
      req.user = user;
      return next();
    })
    .catch(next);
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ errors: ['Действие доступно только администратору.'] });
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
