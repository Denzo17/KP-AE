import express from 'express';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { COMPANY_LIST, COMPANIES } from './companies.js';
import {
  normalizeInvoice, calculate, validate,
  PAYMENT_TERMS, DELIVERY_TERMS, VAT_RATES
} from './model.js';
import { renderInvoice } from './render.js';
import { htmlToPdf, closeBrowser } from './pdf.js';
import { saveInvoice, loadInvoice, updateInvoice, listInvoices } from './storage.js';
import { listItems, rememberItems, importItems, parseCatalogCsv, listCurrencies, addCurrency } from './catalog.js';
import { nextNumber } from './numbering.js';
import { bitrix } from './bitrix.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: 'text/csv', limit: '2mb' }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

const webUrl = (id) => `${config.baseUrl}/i/${id}`;
const pdfUrl = (id) => `${config.baseUrl}/i/${id}.pdf`;

// Имя файла собирается из клиента и номера счёта — по требованию заказчика
// клиент должен быть виден прямо в названии.
function fileNameFor(invoice) {
  const parts = ['Счёт', invoice.number, invoice.client.name].filter(Boolean);
  return parts.join(' ').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() + '.pdf';
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// --- Справочники для формы ---------------------------------------------

app.get('/api/reference', asyncRoute(async (req, res) => {
  res.json({
    companies: COMPANY_LIST,
    paymentTerms: PAYMENT_TERMS,
    deliveryTerms: DELIVERY_TERMS,
    vatRates: VAT_RATES,
    currencies: await listCurrencies(),
    catalog: await listItems(),
    bitrixEnabled: bitrix.enabled
  });
}));

app.get('/api/next-number', asyncRoute(async (req, res) => {
  res.json({ number: await nextNumber(req.query.company, req.query.year) });
}));

app.post('/api/currencies', asyncRoute(async (req, res) => {
  res.json({ currencies: await addCurrency(req.body?.code, req.body?.label) });
}));

app.post('/api/catalog/import', asyncRoute(async (req, res) => {
  const items = typeof req.body === 'string'
    ? parseCatalogCsv(req.body)
    : (Array.isArray(req.body?.items) ? req.body.items : []);
  res.json({ imported: items.length, catalog: await importItems(items) });
}));

// --- Предпросчёт без сохранения ----------------------------------------

app.post('/api/preview', (req, res) => {
  const invoice = normalizeInvoice(req.body);
  res.json({ errors: validate(invoice), totals: calculate(invoice), invoice });
});

// --- Счета --------------------------------------------------------------

app.get('/api/invoices', asyncRoute(async (req, res) => {
  const list = await listInvoices();
  res.json(list.map((inv) => ({
    id: inv.id,
    number: inv.number,
    docDate: inv.docDate,
    client: inv.client.name,
    company: COMPANIES[inv.company]?.label || inv.company,
    total: calculate(inv).total,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt || null,
    url: webUrl(inv.id)
  })));
}));

app.post('/api/invoices', asyncRoute(async (req, res) => {
  const invoice = normalizeInvoice(req.body);
  const errors = validate(invoice);
  if (errors.length) {
    return res.status(400).json({ errors });
  }
  const saved = await saveInvoice(invoice);
  // Введённые вручную позиции запоминаются в справочнике.
  await rememberItems(invoice.items);
  res.status(201).json({ id: saved.id, url: webUrl(saved.id), pdf: pdfUrl(saved.id) });
}));

app.get('/api/invoices/:id', asyncRoute(async (req, res) => {
  const invoice = await loadInvoice(req.params.id);
  if (!invoice) {
    return res.status(404).json({ errors: ['Счёт не найден.'] });
  }
  res.json({ invoice, totals: calculate(invoice), url: webUrl(invoice.id), pdf: pdfUrl(invoice.id) });
}));

app.put('/api/invoices/:id', asyncRoute(async (req, res) => {
  const invoice = normalizeInvoice(req.body);
  const errors = validate(invoice);
  if (errors.length) {
    return res.status(400).json({ errors });
  }
  const saved = await updateInvoice(req.params.id, invoice);
  if (!saved) {
    return res.status(404).json({ errors: ['Счёт не найден.'] });
  }
  await rememberItems(invoice.items);
  res.json({ id: saved.id, url: webUrl(saved.id), pdf: pdfUrl(saved.id) });
}));

// --- Постоянная ссылка и PDF -------------------------------------------

app.get('/i/:id.pdf', asyncRoute(async (req, res) => {
  const invoice = await loadInvoice(req.params.id);
  if (!invoice) {
    return res.status(404).send('Счёт не найден');
  }
  const pdf = await htmlToPdf(renderInvoice(invoice));
  const name = fileNameFor(invoice);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="invoice-${invoice.id}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`
  );
  res.send(pdf);
}));

app.get('/i/:id', asyncRoute(async (req, res) => {
  const invoice = await loadInvoice(req.params.id);
  if (!invoice) {
    return res.status(404).send('Счёт не найден');
  }
  res.type('html').send(renderInvoice(invoice));
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ errors: ['Внутренняя ошибка сервера.'] });
});

const server = app.listen(config.port, () => {
  console.log(`KP-AE слушает ${config.baseUrl} (порт ${config.port})`);
});

// Chromium держится живым между запросами, поэтому его надо закрыть явно,
// иначе процесс не завершится по сигналу.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => closeBrowser().then(() => process.exit(0)));
  });
}
