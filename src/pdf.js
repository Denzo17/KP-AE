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
  if (!browserPromise) {
    browserPromise = launch();
  }
  let browser = await browserPromise;
  if (!browser.connected) {
    // Chromium мог упасть (например, по OOM) — поднимаем заново.
    browserPromise = launch();
    browser = await browserPromise;
  }
  return browser;
}

export async function htmlToPdf(html) {
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
