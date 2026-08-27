#!/usr/bin/env node
// Управление учётными записями из консоли сервера.
//
//   node scripts/user.js list
//   node scripts/user.js add <логин> <admin|manager> [пароль] [Имя]
//   node scripts/user.js passwd <логин> [пароль]
//   node scripts/user.js remove <логин>
//
// Пароль, если не задан, генерируется и печатается один раз.

import { randomBytes } from 'node:crypto';
import { chownSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { execFileSync } from 'node:child_process';
import { config } from '../config.js';
import { listUsers, upsertUser, removeUser, ROLES, ROLE_LABELS } from '../src/users.js';

function generatePassword() {
  return randomBytes(12).toString('base64').replace(/[/+=]/g, '').slice(0, 14);
}

// Файл создаётся от root, а читает его сервис под своим пользователем —
// без смены владельца пароли просто не прочитаются после перезапуска.
function fixOwnership() {
  const path = join(config.dataDir, 'users.json');
  if (!existsSync(path) || userInfo().uid !== 0) {
    return;
  }
  const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
  let uid;
  let gid;
  try {
    uid = Number(execFileSync('id', ['-u', 'kpae'], quiet).trim());
    gid = Number(execFileSync('id', ['-g', 'kpae'], quiet).trim());
  } catch (err) {
    // Пользователя kpae нет — значит это не боевой сервер, менять нечего.
    return;
  }
  try {
    chownSync(path, uid, gid);
  } catch (err) {
    console.warn('Не удалось сменить владельца users.json — проверьте права вручную.');
  }
}

async function printList() {
  const users = await listUsers();
  if (!users.length) {
    console.log('Пользователей нет. Действует запасная учётка из /etc/kp-ae.env.');
    return;
  }
  console.log('Логин'.padEnd(16) + 'Роль'.padEnd(18) + 'Имя');
  users.forEach((u) => {
    console.log(u.login.padEnd(16) + (ROLE_LABELS[u.role] || u.role).padEnd(18) + (u.name || ''));
  });
}

const [command, login, ...rest] = process.argv.slice(2);

try {
  if (command === 'list') {
    await printList();
  } else if (command === 'add') {
    const role = rest[0];
    if (!ROLES.includes(role)) {
      throw new Error(`Укажите роль: ${ROLES.join(' или ')}. Пример: add ivan manager`);
    }
    const password = rest[1] || generatePassword();
    const name = rest.slice(2).join(' ');
    const wasEmpty = (await listUsers()).length === 0;
    await upsertUser({ login, password, role, name });
    fixOwnership();
    console.log(`Готово. Логин: ${login}   Пароль: ${password}`);
    if (wasEmpty) {
      console.log('\nВНИМАНИЕ: заведён первый пользователь, поэтому запасная учётная');
      console.log('запись из AUTH_USER/AUTH_PASSWORD больше не действует.');
      console.log('Заведите себе администратора, если ещё не сделали этого.');
    }
  } else if (command === 'passwd') {
    const password = rest[0] || generatePassword();
    const users = await listUsers();
    const user = users.find((u) => u.login === String(login || '').toLowerCase());
    if (!user) {
      throw new Error(`Пользователь ${login} не найден.`);
    }
    await upsertUser({ login, password, role: user.role, name: user.name });
    fixOwnership();
    console.log(`Пароль изменён. Логин: ${user.login}   Пароль: ${password}`);
  } else if (command === 'remove') {
    const removed = await removeUser(login);
    fixOwnership();
    console.log(removed ? `Пользователь ${login} удалён.` : `Пользователь ${login} не найден.`);
  } else {
    console.log('Команды:');
    console.log('  node scripts/user.js list');
    console.log('  node scripts/user.js add <логин> <admin|manager> [пароль] [Имя]');
    console.log('  node scripts/user.js passwd <логин> [пароль]');
    console.log('  node scripts/user.js remove <логин>');
    process.exit(1);
  }
} catch (err) {
  console.error('Ошибка:', err.message);
  process.exit(1);
}
