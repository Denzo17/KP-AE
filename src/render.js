import { calculate, paymentTerm, deliveryTerm, money, formatDate } from './model.js';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

const e = escapeHtml;

function paymentLabel(invoice) {
  return invoice.paymentTerms === 'custom'
    ? invoice.paymentTermsCustom
    : paymentTerm(invoice.paymentTerms).label;
}

function deliveryLabel(invoice) {
  return invoice.deliveryTerms === 'custom'
    ? invoice.deliveryTermsCustom
    : deliveryTerm(invoice.deliveryTerms).label;
}

function supplierLine(company) {
  return [
    company.fullName,
    company.inn ? `ИНН ${company.inn}` : '',
    company.kpp ? `КПП ${company.kpp}` : '',
    company.address
  ].filter(Boolean).join(', ');
}

function conditionRow(label, value) {
  return value ? `<div class="cond"><span class="cond__label">${e(label)}</span> ${e(value)}</div>` : '';
}

// Один шаблон обслуживает и веб-страницу по ссылке, и PDF: печатная версия
// получается из тех же стилей через @page/@media print, поэтому файл и
// страница не могут разъехаться.
export function renderInvoice(invoice) {
  const r = calculate(invoice);
  const company = r.company;

  const rows = r.lines.map((line, i) => `
          <tr>
            <td class="num">${i + 1}</td>
            <td>
              <div class="item__name">${e(line.name)}</div>
              ${line.sku ? `<div class="item__meta">арт. ${e(line.sku)}</div>` : ''}
              ${line.totalWeight ? `<div class="item__meta">вес ${e(money.format(line.totalWeight))} кг</div>` : ''}
            </td>
            <td class="num">${e(line.leadTimeLabel)}</td>
            <td class="num">${e(String(line.qty))}</td>
            <td class="num">${e(line.unit)}</td>
            <td class="num">${e(money.format(line.unitPrice))}</td>
            <td class="num">${e(money.format(line.sum))}</td>
          </tr>`).join('');

  const validUntil = invoice.offerValidDays
    ? `${invoice.offerValidDays} дн. с даты счёта`
    : '';

  const currencyNote = invoice.currency === 'RUB'
    ? 'Оплата счёта производится в рублях'
    : `Оплата счёта производится в рублях. Расчёт по курсу ${money.format(r.rate)} ₽ за 1 ${e(invoice.currency)}`;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Счёт${invoice.number ? ' № ' + e(invoice.number) : ''}${invoice.client.name ? ' — ' + e(invoice.client.name) : ''}</title>
<style>
  :root { --ink: #14181d; --muted: #6b7480; --line: #c9ced4; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 12px; background: #f2f4f6; color: var(--ink);
         font: 13px/1.45 "Times New Roman", Georgia, serif; }
  .sheet { max-width: 800px; margin: 0 auto; background: #fff; padding: 40px;
           box-shadow: 0 1px 4px rgba(0,0,0,.1); }
  .bank { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  .bank td { border: 1px solid var(--ink); padding: 4px 6px; vertical-align: top; }
  .bank .cap { font-size: 11px; color: var(--muted); }
  .bank .wide { width: 55%; }
  h1 { font-size: 20px; margin: 18px 0 14px; text-align: left; }
  h1 .rule { display: block; border-bottom: 2px solid var(--ink); margin-top: 6px; }
  .party { margin-bottom: 8px; display: flex; gap: 8px; }
  .party__label { flex: 0 0 150px; color: var(--muted); }
  .party__value { flex: 1; }
  table.items { width: 100%; border-collapse: collapse; margin: 18px 0 12px; }
  table.items th { border: 1px solid var(--ink); padding: 5px 6px; font-size: 12px; background: #f4f4f4; }
  table.items td { border: 1px solid var(--ink); padding: 6px; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .item__meta { color: var(--muted); font-size: 11px; }
  .totals { margin-left: auto; width: 60%; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
  .totals .grand { font-weight: bold; font-size: 15px; border-top: 1px solid var(--ink); padding-top: 6px; }
  .summary { margin: 10px 0 20px; font-weight: bold; }
  .conds { border-top: 1px solid var(--line); padding-top: 14px; margin-bottom: 20px; }
  .cond { margin-bottom: 4px; }
  .cond__label { color: var(--muted); }
  .notes { white-space: pre-wrap; margin-bottom: 24px; }
  .sign { display: flex; align-items: flex-end; gap: 16px; margin-top: 40px; }
  .sign__slot { flex: 1; border-bottom: 1px solid var(--ink); }
  .sign__cap { font-size: 11px; color: var(--muted); text-align: center; }
  @page { size: A4; margin: 14mm; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; padding: 0; max-width: none; }
    tr { break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <table class="bank">
      <tr>
        <td rowspan="2" class="wide">${e(company.bank.name)}<div class="cap">Банк получателя</div></td>
        <td class="cap">БИК</td>
        <td>${e(company.bank.bik)}</td>
      </tr>
      <tr>
        <td class="cap">Сч. №</td>
        <td>${e(company.bank.corrAccount)}</td>
      </tr>
      <tr>
        <td class="wide">ИНН ${e(company.inn)}${company.kpp ? '&nbsp;&nbsp;КПП ' + e(company.kpp) : ''}</td>
        <td class="cap">Сч. №</td>
        <td>${e(company.bank.account)}</td>
      </tr>
      <tr>
        <td class="wide">${e(company.fullName)}<div class="cap">Получатель</div></td>
        <td colspan="2"></td>
      </tr>
    </table>

    <h1>Счёт на оплату № ${e(invoice.number || '___')} от ${e(formatDate(invoice.docDate))}<span class="rule"></span></h1>

    <div class="party">
      <div class="party__label">Поставщик (Исполнитель):</div>
      <div class="party__value">${e(supplierLine(company))}</div>
    </div>
    <div class="party">
      <div class="party__label">Покупатель (Заказчик):</div>
      <div class="party__value">${e([invoice.client.name, invoice.client.inn ? 'ИНН ' + invoice.client.inn : '', invoice.client.address].filter(Boolean).join(', '))}</div>
    </div>
    ${invoice.basis ? `<div class="party"><div class="party__label">Основание:</div><div class="party__value">${e(invoice.basis)}</div></div>` : ''}

    <table class="items">
      <thead>
        <tr>
          <th class="num">№</th>
          <th>Товары (работы, услуги)</th>
          <th class="num">Срок</th>
          <th class="num">Кол-во</th>
          <th class="num">Ед.</th>
          <th class="num">Цена</th>
          <th class="num">Сумма</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>

    <div class="totals">
      <div><span>Итого:</span><span>${e(money.format(r.total))} ₽</span></div>
      <div><span>В том числе НДС ${e(String(invoice.vatRate))}%:</span><span>${e(money.format(r.vat))} ₽</span></div>
      <div class="grand"><span>Всего к оплате:</span><span>${e(money.format(r.total))} ₽</span></div>
    </div>

    <div class="summary">
      Всего наименований ${r.count}, на сумму ${e(money.format(r.total))} ₽${r.weight ? `, общий вес ${e(money.format(r.weight))} кг` : ''}
    </div>

    <div class="conds">
      ${conditionRow('Условия оплаты:', paymentLabel(invoice))}
      ${conditionRow('Срок поставки:', invoice.deliveryTime)}
      ${conditionRow('Срок действия счёта:', validUntil)}
      ${conditionRow('Условия поставки:', deliveryLabel(invoice))}
      ${conditionRow('Валюта оплаты:', currencyNote)}
      ${conditionRow('Гарантия на оборудование:', invoice.warrantyMonths ? `${invoice.warrantyMonths} мес.` : '')}
      ${conditionRow('Контакты:', invoice.contacts)}
    </div>

    ${invoice.notes ? `<div class="notes">${e(invoice.notes)}</div>` : ''}

    <div class="sign">
      <div>${e(company.signer.position)}</div>
      <div class="sign__slot"></div>
      <div>${e(company.signer.name)}</div>
    </div>
    <div class="sign__cap" style="margin-top:4px">подпись</div>
  </div>
</body>
</html>`;
}
