import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { config } from '../config.js';
import { BASE_CURRENCIES } from './model.js';

// Справочник: номенклатура «с памятью» и пользовательские валюты.
// Позиция, введённая руками, запоминается и в следующий раз предлагается
// подсказкой, поэтому одно и то же не приходится набирать заново.

const catalogPath = join(config.dataDir, 'catalog.json');

const EMPTY = { items: [], currencies: [], managers: [] };

async function read() {
  try {
    const parsed = JSON.parse(await readFile(catalogPath, 'utf8'));
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      currencies: Array.isArray(parsed.currencies) ? parsed.currencies : [],
      managers: Array.isArray(parsed.managers) ? parsed.managers : []
    };
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { ...EMPTY };
    }
    throw e;
  }
}

async function write(data) {
  await mkdir(dirname(catalogPath), { recursive: true });
  await writeFile(catalogPath, JSON.stringify(data, null, 2), 'utf8');
}

// Ключ позиции — артикул, если он есть, иначе имя: так одна и та же
// номенклатура не двоится из-за регистра или лишних пробелов.
function keyOf(item) {
  return (item.sku || item.name || '').trim().toLowerCase();
}

export async function listItems() {
  const { items } = await read();
  return items.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export async function rememberItems(items) {
  if (!items.length) {
    return;
  }
  const data = await read();
  const byKey = new Map(data.items.map((item) => [keyOf(item), item]));

  items.forEach((item) => {
    const key = keyOf(item);
    if (!key) {
      return;
    }
    // Последние введённые значения важнее: цена закупа и вес обновляются.
    byKey.set(key, {
      name: item.name,
      sku: item.sku || '',
      unit: item.unit || 'шт.',
      purchasePrice: item.purchasePrice || 0,
      weight: item.weight || 0,
      usedAt: new Date().toISOString()
    });
  });

  data.items = [...byKey.values()];
  await write(data);
}

// Импорт текущей номенклатуры. Понимает массив объектов (JSON) и CSV с
// заголовком; названия колонок — русские или английские.
export function parseCatalogCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    return [];
  }
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());

  const pick = (row, names) => {
    for (const name of names) {
      const i = headers.indexOf(name);
      if (i !== -1) {
        return (row[i] || '').trim();
      }
    }
    return '';
  };

  return lines.slice(1).map((line) => {
    const row = line.split(sep);
    return {
      name: pick(row, ['наименование', 'название', 'name']),
      sku: pick(row, ['артикул', 'код', 'sku']),
      unit: pick(row, ['ед.', 'ед', 'единица', 'unit']) || 'шт.',
      purchasePrice: Number(String(pick(row, ['цена закупа', 'цена', 'price'])).replace(',', '.')) || 0,
      weight: Number(String(pick(row, ['вес', 'вес кг', 'weight'])).replace(',', '.')) || 0
    };
  }).filter((item) => item.name !== '');
}

export async function importItems(items) {
  await rememberItems(items);
  return listItems();
}

export async function listCurrencies() {
  const { currencies } = await read();
  const byCode = new Map(BASE_CURRENCIES.map((c) => [c.code, c]));
  currencies.forEach((c) => byCode.set(c.code, c));
  return [...byCode.values()];
}

export async function addCurrency(code, label) {
  // Код валюты приходит из формы, поэтому обрезаем: в справочник не должна
  // попадать строка произвольной длины.
  const normalized = String(code || '').trim().toUpperCase().slice(0, 8);
  if (!/^[A-Z]{2,8}$/.test(normalized)) {
    return listCurrencies();
  }
  const data = await read();
  if (!data.currencies.some((c) => c.code === normalized) &&
      !BASE_CURRENCIES.some((c) => c.code === normalized)) {
    data.currencies.push({ code: normalized, label: String(label || normalized).trim().slice(0, 40) });
    await write(data);
  }
  return listCurrencies();
}


// Менеджеры: тот же принцип, что и с номенклатурой — кто выписал счёт хоть
// раз, тот дальше выбирается из списка, а не набирается заново.
export async function listManagers() {
  const { managers } = await read();
  return managers.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export async function rememberManager(manager) {
  const name = String(manager?.name || '').trim();
  if (!name) {
    return;
  }
  const data = await read();
  const key = name.toLowerCase();
  const rest = data.managers.filter((m) => m.name.trim().toLowerCase() !== key);
  rest.push({
    name,
    phone: String(manager.phone || '').trim(),
    email: String(manager.email || '').trim(),
    usedAt: new Date().toISOString()
  });
  data.managers = rest;
  await write(data);
}
