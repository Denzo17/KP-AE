import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { normalizeInvoice } from './model.js';

// Файловое хранилище счетов: один счёт — один JSON. Переезд между серверами
// сводится к копированию каталога data. Если понадобится поиск и фильтрация,
// меняется только этот модуль.

const dir = join(config.dataDir, 'kp');

function newId() {
  // 12 hex-символов: ссылку не подобрать перебором, но она остаётся короткой.
  return randomBytes(6).toString('hex');
}

export function isValidId(id) {
  return typeof id === 'string' && /^[0-9a-f]{12}$/.test(id);
}

function pathFor(id) {
  return join(dir, `${id}.json`);
}

export async function saveInvoice(data, owner) {
  await mkdir(dir, { recursive: true });
  const id = newId();
  // Владелец берётся из сессии, а не из тела запроса: иначе менеджер мог бы
  // записать счёт на чужое имя, подставив поле в JSON.
  const record = { ...data, id, owner: owner || null, createdAt: new Date().toISOString() };
  await writeFile(pathFor(id), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

// Записи, сохранённые более ранней версией, могут не иметь появившихся
// позже полей. Прогоняем прочитанное через нормализацию, иначе старый счёт
// роняет страницу на первом же обращении к новому полю.
function hydrate(raw) {
  return {
    ...normalizeInvoice(raw),
    id: raw.id,
    owner: raw.owner || null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt || null
  };
}

export async function loadInvoice(id) {
  if (!isValidId(id)) {
    return null;
  }
  try {
    return hydrate(JSON.parse(await readFile(pathFor(id), 'utf8')));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

// Редактирование уже сформированного счёта: id и дата создания сохраняются,
// поэтому выданная ранее ссылка продолжает работать и показывает свежую версию.
export async function updateInvoice(id, data) {
  const existing = await loadInvoice(id);
  if (!existing) {
    return null;
  }
  const record = {
    ...data,
    id: existing.id,
    // Владелец счёта при правках не меняется.
    owner: existing.owner || null,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString()
  };
  await writeFile(pathFor(id), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

export async function listInvoices() {
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const records = await Promise.all(
    files.map(async (f) => hydrate(JSON.parse(await readFile(join(dir, f), 'utf8'))))
  );
  return records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
