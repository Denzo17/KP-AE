import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { config } from '../config.js';

// Учётные записи. Пароли хранятся только в виде scrypt-хеша: даже с доступом
// к файлу восстановить исходный пароль нельзя.
//
// Роли:
//   admin   — видит и правит все счета, заводит пользователей
//   manager — видит и правит только свои
//
// Пока файла пользователей нет, работает единственная учётка из переменных
// окружения (AUTH_USER / AUTH_PASSWORD) с правами админа. Как только заведён
// первый пользователь, эта запасная учётка перестаёт действовать — иначе
// пароль из окружения остался бы вечным чёрным ходом.

const usersPath = join(config.dataDir, 'users.json');

export const ROLES = ['admin', 'manager'];
export const ROLE_LABELS = { admin: 'Администратор', manager: 'Менеджер' };

const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, KEY_LENGTH).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const expected = Buffer.from(parts[2], 'hex');
  let candidate;
  try {
    candidate = scryptSync(String(password), parts[1], expected.length || KEY_LENGTH);
  } catch (err) {
    return false;
  }
  if (candidate.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(candidate, expected);
}

async function readUsers() {
  try {
    const parsed = JSON.parse(await readFile(usersPath, 'utf8'));
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

async function writeUsers(users) {
  await mkdir(dirname(usersPath), { recursive: true });
  await writeFile(usersPath, JSON.stringify({ users }, null, 2), 'utf8');
}

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}

export async function listUsers() {
  const users = await readUsers();
  return users
    .map((u) => ({ login: u.login, name: u.name || '', role: u.role, createdAt: u.createdAt }))
    .sort((a, b) => a.login.localeCompare(b.login, 'ru'));
}

export async function upsertUser({ login, password, role, name = '' }) {
  const key = normalizeLogin(login);
  if (!/^[a-z0-9._-]{2,32}$/.test(key)) {
    throw new Error('Логин: 2–32 символа, латиница, цифры, точка, дефис, подчёркивание.');
  }
  if (role && !ROLES.includes(role)) {
    throw new Error(`Роль должна быть одной из: ${ROLES.join(', ')}`);
  }
  const users = await readUsers();
  const existing = users.find((u) => u.login === key);

  if (existing) {
    // Роль меняем только если её явно передали: смена пароля не должна
    // понижать администратора до менеджера.
    if (role) {
      existing.role = role;
    }
    if (name) {
      existing.name = name;
    }
    if (password) {
      existing.passwordHash = hashPassword(password);
    }
  } else {
    role = role || 'manager';
    if (!password) {
      throw new Error('Для новой учётной записи нужен пароль.');
    }
    users.push({
      login: key,
      name: name || key,
      role,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    });
  }
  await writeUsers(users);
  return key;
}

export async function removeUser(login) {
  const key = normalizeLogin(login);
  const users = await readUsers();
  const rest = users.filter((u) => u.login !== key);
  if (rest.length === users.length) {
    return false;
  }
  // Без администратора сервисом станет невозможно управлять.
  if (!rest.some((u) => u.role === 'admin')) {
    throw new Error('Нельзя удалить последнего администратора.');
  }
  await writeUsers(rest);
  return true;
}

// Фиктивный хеш для несуществующих логинов: сравнение занимает столько же
// времени, что и настоящее, и по задержке ответа нельзя перебрать логины.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

export async function authenticate(login, password) {
  const key = normalizeLogin(login);
  const users = await readUsers();

  if (users.length === 0) {
    // Запасная учётка из окружения действует, пока не заведён ни один
    // пользователь. Пароль там хранится открытым, поэтому сравниваем строки
    // напрямую, но временем постоянным сравнением.
    const expected = Buffer.from(String(config.auth.password));
    const given = Buffer.from(String(password));
    const ok = Boolean(config.auth.password) &&
      key === normalizeLogin(config.auth.user) &&
      expected.length === given.length &&
      timingSafeEqual(expected, given);
    return ok ? { login: key, name: key, role: 'admin', fromEnv: true } : null;
  }

  const user = users.find((u) => u.login === key);
  const ok = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    return null;
  }
  return { login: user.login, name: user.name || user.login, role: user.role };
}

export async function hasUsers() {
  return (await readUsers()).length > 0;
}
