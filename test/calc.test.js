import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInvoice, calculate, validate, leadTimeLabel } from '../src/model.js';
import { amountInWords, plural } from '../src/amount-in-words.js';

// Базовый счёт: закуп 100 юаней по курсу 12, доставка 200, страховка 50,
// наценка 1,25, две штуки. Считаем вручную и сверяем с движком.
function invoice(overrides = {}) {
  return normalizeInvoice({
    client: { name: 'ООО «Ромашка»' },
    currency: 'CNY',
    rate: 12,
    paymentTerms: 'half',
    markupMode: 'all',
    markup: 1.25,
    items: [{
      name: 'Вольтметр',
      qty: 2,
      purchasePrice: 100,
      delivery: 200,
      insurance: 50,
      weight: 3.5
    }],
    ...overrides
  });
}

test('ИП: логистика входит в цену, коэффициент 1,2', () => {
  const r = calculate(invoice({ company: 'ip' }));
  // (100 × 12 + 200 + 50) × 1,2 = 1740; × 1,25 = 2175
  assert.equal(r.lines[0].purchaseRub, 1200);
  assert.equal(r.lines[0].logistics, 250);
  assert.equal(r.lines[0].cost, 1740);
  assert.equal(r.lines[0].unitPrice, 2175);
  assert.equal(r.total, 4350);
});

test('ООО: логистика в цену не входит, коэффициент 1,5', () => {
  const r = calculate(invoice({ company: 'ooo' }));
  // 100 × 12 × 1,5 = 1800; × 1,25 = 2250
  assert.equal(r.lines[0].logistics, 0);
  assert.equal(r.lines[0].cost, 1800);
  assert.equal(r.lines[0].unitPrice, 2250);
  assert.equal(r.total, 4500);
});

test('ставка НДС подставляется по выбору компании', () => {
  assert.equal(invoice({ company: 'ip' }).vatRate, 5);
  assert.equal(invoice({ company: 'ooo' }).vatRate, 22);
});

test('ставку НДС можно переопределить вручную', () => {
  assert.equal(invoice({ company: 'ooo', vatRate: 0 }).vatRate, 0);
  assert.equal(invoice({ company: 'ip', vatRate: 22 }).vatRate, 22);
});

test('НДС считается «в том числе», а не сверху', () => {
  const ip = calculate(invoice({ company: 'ip' }));
  assert.equal(ip.vat, 207.14); // 4350 × 5 / 105
  assert.equal(ip.withoutVat, 4142.86);
  assert.equal(ip.vat + ip.withoutVat, ip.total);

  const ooo = calculate(invoice({ company: 'ooo' }));
  assert.equal(ooo.vat, 811.48); // 4500 × 22 / 122
});

test('нулевая ставка НДС не даёт налога', () => {
  const r = calculate(invoice({ company: 'ip', vatRate: 0 }));
  assert.equal(r.vat, 0);
  assert.equal(r.withoutVat, r.total);
});

test('рубль игнорирует курс', () => {
  const r = calculate(invoice({ company: 'ooo', currency: 'RUB', rate: 99 }));
  assert.equal(r.lines[0].purchaseRub, 100);
});

test('наценка ниже минимальной для условий оплаты не проходит', () => {
  const errors = validate(invoice({ company: 'ip', paymentTerms: 'deferred100', markup: 1.25 }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ниже минимальной 1\.35/);
});

test('минимумы наценки соответствуют условиям оплаты', () => {
  const cases = [['deferred100', 1.35], ['half', 1.25], ['prepay100', 1.2]];
  for (const [terms, min] of cases) {
    assert.deepEqual(validate(invoice({ company: 'ip', paymentTerms: terms, markup: min })), []);
    assert.equal(validate(invoice({ company: 'ip', paymentTerms: terms, markup: min - 0.01 })).length, 1);
  }
});

test('свой вариант оплаты снимает минимум, но требует текст', () => {
  const withoutText = validate(invoice({ company: 'ip', paymentTerms: 'custom', markup: 1.01 }));
  assert.equal(withoutText.length, 1);
  assert.match(withoutText[0], /текст не заполнен/);

  const withText = validate(invoice({
    company: 'ip', paymentTerms: 'custom', paymentTermsCustom: 'По договорённости', markup: 1.01
  }));
  assert.deepEqual(withText, []);
});

test('индивидуальная наценка перекрывает общую', () => {
  const inv = invoice({
    company: 'ooo',
    markupMode: 'individual',
    markup: 1.25,
    items: [
      { name: 'A', qty: 1, purchasePrice: 100, markup: 1.5 },
      { name: 'B', qty: 1, purchasePrice: 100 }
    ]
  });
  const r = calculate(inv);
  assert.equal(r.lines[0].appliedMarkup, 1.5);
  assert.equal(r.lines[1].appliedMarkup, 1.25); // пустая — берётся общая
});

test('индивидуальная наценка тоже проверяется на минимум', () => {
  const errors = validate(invoice({
    company: 'ip', paymentTerms: 'deferred100', markupMode: 'individual', markup: 1.4,
    items: [{ name: 'A', qty: 1, purchasePrice: 100, markup: 1.1 }]
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Позиция 1/);
});

test('пустые поля берут значение по умолчанию, а не ноль', () => {
  const inv = normalizeInvoice({
    company: 'ip', client: { name: 'X' },
    rate: '', offerValidDays: '', warrantyMonths: '', vatRate: '', items: []
  });
  assert.equal(inv.vatRate, 5);
  assert.equal(inv.offerValidDays, 15);
  assert.equal(inv.warrantyMonths, 12);
});

test('запятая как десятичный разделитель понимается', () => {
  const r = calculate(invoice({ company: 'ooo', rate: '12,5' }));
  assert.equal(r.lines[0].purchaseRub, 1250);
});

test('позиции без наименования отбрасываются', () => {
  const inv = invoice({ company: 'ip', items: [{ name: '', qty: 1 }, { name: 'A', qty: 1 }] });
  assert.equal(inv.items.length, 1);
});

test('счёт без клиента и без позиций не проходит', () => {
  const errors = validate(normalizeInvoice({ company: 'ip', items: [] }));
  assert.ok(errors.some((e) => /покупатель/.test(e)));
  assert.ok(errors.some((e) => /ни одной позиции/.test(e)));
});

test('курс обязателен для валюты, отличной от рубля', () => {
  const errors = validate(invoice({ company: 'ip', rate: 0 }));
  assert.ok(errors.some((e) => /курс валюты CNY/.test(e)));
});

test('перевёрнутый диапазон срока поставки отлавливается', () => {
  const errors = validate(invoice({
    company: 'ip',
    items: [{ name: 'A', qty: 1, purchasePrice: 10, leadTime: { mode: 'range', from: 12, to: 4 } }]
  }));
  assert.ok(errors.some((e) => /«от» больше, чем «до»/.test(e)));
});

test('срок поставки отображается по режиму', () => {
  assert.equal(leadTimeLabel({ mode: 'weeks', weeks: 6 }), '6 нед.');
  assert.equal(leadTimeLabel({ mode: 'range', from: 10, to: 12 }), '10–12 нед.');
  assert.equal(leadTimeLabel({ mode: 'custom', text: 'со склада' }), 'со склада');
});

test('количество недель зажимается в 1–12', () => {
  const inv = invoice({
    company: 'ip',
    items: [{ name: 'A', qty: 1, purchasePrice: 10, leadTime: { mode: 'weeks', weeks: 99 } }]
  });
  assert.equal(inv.items[0].leadTime.weeks, 12);
});

test('вес суммируется по количеству', () => {
  const r = calculate(invoice({ company: 'ip' }));
  assert.equal(r.weight, 7); // 3,5 × 2
});

test('сумма прописью склоняется правильно', () => {
  assert.equal(amountInWords(7160.4), 'Семь тысяч сто шестьдесят рублей 40 копеек');
  assert.equal(amountInWords(1000), 'Одна тысяча рублей 00 копеек');
  assert.equal(amountInWords(2000), 'Две тысячи рублей 00 копеек');
  assert.equal(amountInWords(21), 'Двадцать один рубль 00 копеек');
  assert.equal(amountInWords(2345678.01), 'Два миллиона триста сорок пять тысяч шестьсот семьдесят восемь рублей 01 копейка');
  assert.equal(amountInWords(0), 'Ноль рублей 00 копеек');
});

test('склонение по числу учитывает 11–19', () => {
  const forms = ['рубль', 'рубля', 'рублей'];
  assert.equal(plural(1, forms), 'рубль');
  assert.equal(plural(11, forms), 'рублей');
  assert.equal(plural(21, forms), 'рубль');
  assert.equal(plural(102, forms), 'рубля');
  assert.equal(plural(112, forms), 'рублей'); // 12 попадает в 11–19
  assert.equal(plural(5, forms), 'рублей');
});
