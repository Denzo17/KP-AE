import puppeteer from 'puppeteer';
import { config } from '../config.js';

// Браузер поднимается один раз и переиспользуется: старт chromium стоит
// секунду-полторы, и делать это на каждый запрос PDF нет смысла.
let browserPromise = null;

function launch() {
  return puppeteer.launch({
    headless: true,
    ...(config.chromiumPath ? { executablePath: config.chromiumPath } : {}),
    // На VPS без этих флагов chromium часто не стартует из-под сервисного
    // пользователя (нет доступа к /dev/shm и к user namespaces).
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
}

async function getBrowser() {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      if (browser.connected) {
        return browser;
      }
    } catch (err) {
      // Прошлый запуск не удался — пробуем ещё раз, а не отдаём ту же ошибку.
    }
    browserPromise = null;
  }

  browserPromise = launch();
  try {
    return await browserPromise;
  } catch (err) {
    // Неудачный промис нельзя оставлять в кэше: иначе один сбой (chromium
    // ещё не установлен, кончилась память) убивает печать до перезапуска.
    browserPromise = null;
    throw err;
  }
}

// Ссылка на счёт публична, а каждая печать — это вкладка chromium.
// Без ограничения одновременных печатей поток запросов съедает память VPS,
// поэтому лишние ждут очереди, а не запускают ещё одну вкладку.
const MAX_CONCURRENT = 2;
let active = 0;
const queue = [];

function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function release() {
  const next = queue.shift();
  if (next) {
    next();
  } else {
    active -= 1;
  }
}

// Проверка, что chromium вообще запускается — вызывается на старте сервера.
export async function checkChromium() {
  try {
    const browser = await getBrowser();
    return { ok: true, version: await browser.version() };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function htmlToPdf(html) {
  await acquire();
  try {
    return await printPage(html);
  } finally {
    release();
  }
}

async function printPage(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' }
    });
    // Puppeteer отдаёт Uint8Array, а express.send() сериализует его в JSON,
    // поэтому в Buffer заворачиваем здесь, а не на стороне маршрута.
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    browserPromise = null;
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
