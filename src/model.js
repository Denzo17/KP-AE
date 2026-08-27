import { getCompany } from './companies.js';

// Модель счёта: справочники, нормализация ввода, расчёт цены и проверки.
// Ядро логики живёт здесь; сервер и шаблон работают только с её результатом.

// Минимальная наценка задана условиями оплаты: чем позже деньги, тем выше
// нижняя граница. Указать больше можно, меньше — нет.
export const PAYMENT_TERMS = [
  { id: 'deferred100', label: 'Отсрочка платежа 100%', minMarkup: 1.35 },
  { id: 'half', label: '50% предоплата / 50% перед отгрузкой', minMarkup: 1.25 },
  { id: 'prepay100', label: '100% предоплата', minMarkup: 1.2 },
  { id: 'custom', label: 'Свой вариант', minMarkup: null }
];

export const DELIVERY_TERMS = [
  { id: 'supplier', label: 'Доставка за счёт поставщика' },
  { id: 'buyer', label: 'Доставка за счёт покупателя' },
  { id: 'pickup', label: 'Самовывоз со склада поставщика' },
  { id: 'custom', label: 'Свой вариант' }
];

// Базовый список валют. Свои валюты добавляются пользователем и хранятся
// в справочнике (src/catalog.js), поэтому этот список — только стартовый.
export const BASE_CURRENCIES = [
  { code: 'RUB', label: 'Рубль' },
  { code: 'CNY', label: 'Юань' },
  { code: 'EUR', label: 'Евро' },
  { code: 'USD', label: 'Доллар' }
];

export const VAT_RATES = [22, 5, 0];

// Единицы измерения позиции. Штуки — по умолчанию.
export const UNITS = ['шт.', 'компл.', 'м', 'л'];

export function paymentTerm(id) {
  return PAYMENT_TERMS.find((t) => t.id === id) || PAYMENT_TERMS[0];
}

export function deliveryTerm(id) {
  return DELIVERY_TERMS.find((t) => t.id === id) || DELIVERY_TERMS[0];
}

function num(value, fallback = 0) {
  // Пустое поле формы должно давать fallback, а не 0: иначе незаполненная
  // ставка НДС или курс молча превращаются в ноль.
  const s = String(value ?? '').replace(',', '.').replace(/\s+/g, '');
  if (s === '') {
    return fallback;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function str(value) {
  return String(value ?? '').trim();
}

// Телефон приводим к +7 (XXX) XXX-XX-XX. Ввести можно как угодно — через
// восьмёрку, без скобок, с пробелами. Непохожее на российский номер
// (например, зарубежный) оставляем как есть, а не ломаем.
export function formatPhone(value) {
  const raw = String(value ?? '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  if (digits[0] === '8') {
    digits = '7' + digits.slice(1);
  }
  if (digits.length === 10) {
    digits = '7' + digits;
  }
  if (digits[0] !== '7' || digits.length !== 11) {
    return raw;
  }
  return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Срок поставки позиции: фиксированное число недель (1–12), свой диапазон
// «от и до» или произвольный текст.
function normalizeLeadTime(raw = {}) {
  const mode = ['weeks', 'range', 'custom'].includes(raw.mode) ? raw.mode : 'weeks';
  return {
    mode,
    weeks: Math.min(Math.max(Math.round(num(raw.weeks, 1)), 1), 12),
    from: Math.max(Math.round(num(raw.from, 1)), 0),
    to: Math.max(Math.round(num(raw.to, 1)), 0),
    text: str(raw.text)
  };
}

export function leadTimeLabel(lead) {
  if (lead.mode === 'custom') {
    return lead.text;
  }
  if (lead.mode === 'range') {
    return `${lead.from}–${lead.to} нед.`;
  }
  return `${lead.weeks} нед.`;
}

export function normalizeInvoice(body = {}) {
  const company = getCompany(str(body.company));
  const items = Array.isArray(body.items) ? body.items : [];
  const markupMode = body.markupMode === 'individual' ? 'individual' : 'all';

  return {
    number: str(body.number),
    docDate: str(body.docDate) || new Date().toISOString().slice(0, 10),
    company: company.id,

    client: {
      name: str(body.client?.name),
      inn: str(body.client?.inn),
      address: str(body.client?.address),
      contact: str(body.client?.contact),
      phone: formatPhone(body.client?.phone),
      email: str(body.client?.email)
    },

    // Основание печатается только в счетах ООО, у ИП его в форме нет —
    // чистим здесь, чтобы значение не утекло при смене компании.
    basis: company.id === 'ooo' ? str(body.basis) : '',

    paymentTerms: str(body.paymentTerms) || 'prepay100',
    paymentTermsCustom: str(body.paymentTermsCustom),

    deliveryTerms: str(body.deliveryTerms) || 'supplier',
    deliveryTermsCustom: str(body.deliveryTermsCustom),

    deliveryTime: str(body.deliveryTime),
    offerValidDays: Math.max(Math.round(num(body.offerValidDays, 30)), 0),
    warrantyMonths: Math.max(Math.round(num(body.warrantyMonths, 12)), 0),

    currency: str(body.currency).toUpperCase() || 'RUB',
    rate: num(body.rate, 1),

    // Ставку НДС задаёт выбор компании (ООО 22%, ИП 5%), но оставляем
    // возможность переопределить вручную — в форме поле предзаполнено.
    vatRate: VAT_RATES.includes(num(body.vatRate, NaN)) ? num(body.vatRate) : company.vatRate,

    markupMode,
    markup: num(body.markup, paymentTerm(str(body.paymentTerms) || 'prepay100').minMarkup || 1.2),

    items: items
      .map((item) => ({
        name: str(item.name),
        sku: str(item.sku),
        unit: str(item.unit) || 'шт.',
        qty: num(item.qty, 1),
        purchasePrice: num(item.purchasePrice, 0),
        delivery: num(item.delivery, 0),
        insurance: num(item.insurance, 0),
        markup: num(item.markup, 0),
        weight: num(item.weight, 0),
        leadTime: normalizeLeadTime(item.leadTime)
      }))
      .filter((item) => item.name !== ''),

    // Менеджер выбирается из справочника; введённый вручную запоминается.
    manager: {
      name: str(body.manager?.name),
      phone: formatPhone(body.manager?.phone),
      email: str(body.manager?.email)
    },
    notes: str(body.notes)
  };
}

// Расчёт конечной цены позиции:
//   ((цена закупа в валюте × курс + доставка + страховка) × коэф. компании) × наценка
// Доставка и страховка участвуют только у ИП: у ООО в коэффициент 1,5 уже
// заложено всё, и логистика в цену отдельно не входит.
export function calculate(invoice) {
  const company = getCompany(invoice.company);
  const rate = invoice.currency === 'RUB' ? 1 : invoice.rate;

  const lines = invoice.items.map((item) => {
    const purchaseRub = item.purchasePrice * rate;
    const logistics = company.includeLogistics ? item.delivery + item.insurance : 0;
    const cost = (purchaseRub + logistics) * company.coefficient;
    const markup = invoice.markupMode === 'individual' && item.markup > 0 ? item.markup : invoice.markup;
    const unitPrice = round2(cost * markup);

    return {
      ...item,
      purchaseRub: round2(purchaseRub),
      logistics: round2(logistics),
      cost: round2(cost),
      appliedMarkup: markup,
      unitPrice,
      sum: round2(unitPrice * item.qty),
      totalWeight: round2(item.weight * item.qty),
      leadTimeLabel: leadTimeLabel(item.leadTime)
    };
  });

  const total = round2(lines.reduce((acc, line) => acc + line.sum, 0));
  // НДС считается «в том числе», как в присланных образцах счетов.
  const vat = invoice.vatRate > 0 ? round2((total * invoice.vatRate) / (100 + invoice.vatRate)) : 0;

  return {
    company,
    rate,
    lines,
    total,
    vat,
    withoutVat: round2(total - vat),
    weight: round2(lines.reduce((acc, line) => acc + line.totalWeight, 0)),
    count: lines.length
  };
}

export function validate(invoice) {
  const errors = [];
  const term = paymentTerm(invoice.paymentTerms);

  if (!invoice.client.name) {
    errors.push('Не указан покупатель.');
  }
  if (invoice.items.length === 0) {
    errors.push('В счёте нет ни одной позиции.');
  }
  if (invoice.currency !== 'RUB' && !(invoice.rate > 0)) {
    errors.push(`Не указан курс валюты ${invoice.currency}.`);
  }
  if (invoice.paymentTerms === 'custom' && !invoice.paymentTermsCustom) {
    errors.push('Выбран свой вариант условий оплаты, но текст не заполнен.');
  }
  if (invoice.deliveryTerms === 'custom' && !invoice.deliveryTermsCustom) {
    errors.push('Выбран свой вариант условий поставки, но текст не заполнен.');
  }

  // Наценка ниже минимальной для выбранных условий оплаты — это ошибка,
  // а не предупреждение: минимум задан правилами, выше ставить можно.
  if (term.minMarkup !== null) {
    if (invoice.markupMode === 'all' && invoice.markup < term.minMarkup) {
      errors.push(
        `Наценка ${invoice.markup} ниже минимальной ${term.minMarkup} для условий «${term.label}».`
      );
    }
    if (invoice.markupMode === 'individual') {
      invoice.items.forEach((item, i) => {
        const applied = item.markup > 0 ? item.markup : invoice.markup;
        if (applied < term.minMarkup) {
          errors.push(
            `Позиция ${i + 1} («${item.name}»): наценка ${applied} ниже минимальной ` +
              `${term.minMarkup} для условий «${term.label}».`
          );
        }
      });
    }
  }

  invoice.items.forEach((item, i) => {
    if (!(item.qty > 0)) {
      errors.push(`Позиция ${i + 1} («${item.name}»): количество должно быть больше нуля.`);
    }
    if (item.purchasePrice < 0) {
      errors.push(`Позиция ${i + 1} («${item.name}»): цена закупа не может быть отрицательной.`);
    }
    if (item.leadTime.mode === 'range' && item.leadTime.from > item.leadTime.to) {
      errors.push(`Позиция ${i + 1} («${item.name}»): срок поставки «от» больше, чем «до».`);
    }
  });

  return errors;
}

export const money = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('ru-RU').format(d);
}
