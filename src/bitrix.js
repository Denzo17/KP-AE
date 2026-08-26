import { config } from '../config.js';

// Точка интеграции с Битрикс24. Реального подключения сейчас нет — здесь
// зафиксирован интерфейс, чтобы подключение не потребовало переписывать ядро.
// Когда появится вебхук, реализация подставляется в этот же модуль, а
// вызывающий код (src/server.js) не меняется.
//
// Включается переменными окружения:
//   BITRIX_WEBHOOK_URL=https://<портал>.bitrix24.ru/rest/<id>/<токен>/
//   BITRIX_ENABLED=1

export const bitrix = {
  get enabled() {
    return Boolean(config.bitrix.enabled && config.bitrix.webhookUrl);
  },

  // Выгрузить сформированный счёт в сделку.
  async pushInvoice(invoice, links) {
    if (!this.enabled) {
      return { skipped: true, reason: 'Интеграция с Битрикс24 выключена' };
    }
    throw new Error('Битрикс24: pushInvoice ещё не реализован');
  },

  // Подтянуть данные клиента из CRM по id контакта или компании.
  async fetchClient(clientId) {
    if (!this.enabled) {
      return null;
    }
    throw new Error('Битрикс24: fetchClient ещё не реализован');
  }
};
