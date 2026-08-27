import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Хранилище пользователей читает путь из конфига на этапе импорта, поэтому
// каталог задаётся до загрузки модуля, а сам модуль подключается динамически.
const dir = mkdtempSync(join(tmpdir(), 'kp-users-'));
process.env.DATA_DIR = dir;
process.env.AUTH_USER = 'manager';
process.env.AUTH_PASSWORD = 'env-secret';

let users;

before(async () => {
  users = await import('../src/users.js');
});

test('пароль хранится хешем, а не открытым текстом', () => {
  const hash = users.hashPassword('тайна');
  assert.ok(hash.startsWith('scrypt:'));
  assert.ok(!hash.includes('тайна'));
  assert.equal(users.verifyPassword('тайна', hash), true);
  assert.equal(users.verifyPassword('не тайна', hash), false);
});

test('битый хеш не пропускает', () => {
  assert.equal(users.verifyPassword('x', ''), false);
  assert.equal(users.verifyPassword('x', 'мусор'), false);
  assert.equal(users.verifyPassword('x', 'scrypt:соль'), false);
});

test('пока пользователей нет, действует запасная учётка из окружения', async () => {
  const ok = await users.authenticate('manager', 'env-secret');
  assert.equal(ok.role, 'admin');
  assert.equal(ok.fromEnv, true);
  assert.equal(await users.authenticate('manager', 'мимо'), null);
});

test('первый заведённый пользователь отключает запасную учётку', async () => {
  await users.upsertUser({ login: 'denis', password: 'p1', role: 'admin', name: 'Денис' });
  assert.equal(await users.authenticate('manager', 'env-secret'), null);
  const admin = await users.authenticate('denis', 'p1');
  assert.equal(admin.role, 'admin');
});

test('логин не зависит от регистра', async () => {
  await users.upsertUser({ login: 'Ivan', password: 'p2', role: 'manager', name: 'Иван' });
  const byLower = await users.authenticate('ivan', 'p2');
  const byUpper = await users.authenticate('IVAN', 'p2');
  assert.equal(byLower.login, 'ivan');
  assert.equal(byUpper.login, 'ivan');
});

test('смена пароля не понижает роль', async () => {
  await users.upsertUser({ login: 'denis', password: 'p3' });
  const admin = await users.authenticate('denis', 'p3');
  assert.equal(admin.role, 'admin', 'администратор должен остаться администратором');
});

test('новый пользователь без указанной роли становится менеджером', async () => {
  await users.upsertUser({ login: 'olga', password: 'p4' });
  const olga = await users.authenticate('olga', 'p4');
  assert.equal(olga.role, 'manager');
});

test('чужой пароль не подходит', async () => {
  assert.equal(await users.authenticate('ivan', 'p1'), null);
  assert.equal(await users.authenticate('нет-такого', 'p1'), null);
});

test('некорректный логин отклоняется', async () => {
  await assert.rejects(() => users.upsertUser({ login: 'а', password: 'x' }));
  await assert.rejects(() => users.upsertUser({ login: 'с кириллицей', password: 'x' }));
  await assert.rejects(() => users.upsertUser({ login: 'ok', password: 'x', role: 'король' }));
});

test('новая учётка без пароля не создаётся', async () => {
  await assert.rejects(() => users.upsertUser({ login: 'nopass', role: 'manager' }));
});

test('последнего администратора удалить нельзя', async () => {
  assert.equal(await users.removeUser('olga'), true);
  await assert.rejects(() => users.removeUser('denis'), /последнего администратора/);
});

test('удаление несуществующего логина ничего не ломает', async () => {
  assert.equal(await users.removeUser('призрак'), false);
  rmSync(dir, { recursive: true, force: true });
});
