// Проверка, что браузер по CHROMIUM_PATH действительно запускается.
// Код возврата 0 — всё в порядке, 1 — печатать PDF нечем.
// Используется деплоем, чтобы починить браузер до перезапуска сервиса,
// а не узнавать о поломке от менеджера, который не смог скачать счёт.
import { checkChromium } from '../src/pdf.js';

const result = await checkChromium();
if (result.ok) {
  console.log(`браузер в порядке: ${result.version}`);
  process.exit(0);
}
console.error(`браузер не запускается: ${result.reason.split('\n')[0]}`);
process.exit(1);
