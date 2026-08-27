import { listInvoices } from './storage.js';

// Автонумерация счетов: сквозная нумерация в пределах компании и года.
// Номер остаётся редактируемым — форма только подставляет следующий
// свободный, чтобы не приходилось помнить, на чём остановились.

function yearOf(invoice) {
  return String(invoice.docDate || invoice.createdAt || '').slice(0, 4);
}

// Номер может быть с суффиксом («128-1»), поэтому берём ведущее число.
function leadingNumber(value) {
  const match = String(value || '').match(/^\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

export async function nextNumber(companyId, year) {
  const target = year || String(new Date().getFullYear());
  const invoices = await listInvoices();

  const used = invoices
    .filter((inv) => inv.company === companyId && yearOf(inv) === target)
    .map((inv) => leadingNumber(inv.number))
    .filter((n) => n !== null);

  return used.length ? Math.max(...used) + 1 : 1;
}
