'use strict';

var ref = { companies: [], paymentTerms: [], deliveryTerms: [], vatRates: [],
            currencies: [], catalog: [], units: ['шт.'], managers: [] };
var lastPreviewHtml = '';
var me = { login: '', name: '', role: 'manager' };
var editingId = null;
var previewTimer = null;
// Номер, поправленный руками, автоподстановка больше не трогает.
var numberTouched = false;

var $ = function (sel, root) { return (root || document).querySelector(sel); };
var money = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// --- Текущий пользователь ------------------------------------------------

function loadMe() {
  return fetch('/api/me').then(function (r) { return r.json(); }).then(function (data) {
    me = data;
    var role = data.role === 'admin' ? 'администратор' : 'менеджер';
    $('#whoami').textContent = (data.name || data.login) + ' · ' + role;
    // Управление учётными записями доступно только администратору. Сервер
    // проверяет это независимо — кнопка лишь убирает лишнее с глаз.
    $('#btn-users').hidden = data.role !== 'admin';
  });
}

// --- Справочники --------------------------------------------------------

function fillSelect(el, options, value) {
  el.innerHTML = '';
  options.forEach(function (opt) {
    var o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    el.appendChild(o);
  });
  if (value !== undefined) {
    el.value = value;
  }
}

function loadReference() {
  return fetch('/api/reference').then(function (r) { return r.json(); }).then(function (data) {
    ref = data;
    fillSelect($('#company'), data.companies.map(function (c) { return { value: c.id, label: c.label }; }));
    fillSelect($('#paymentTerms'), data.paymentTerms.map(function (t) { return { value: t.id, label: t.label }; }), 'prepay100');
    fillSelect($('#deliveryTerms'), data.deliveryTerms.map(function (t) { return { value: t.id, label: t.label }; }));
    fillSelect($('#vatRate'), data.vatRates.map(function (v) { return { value: String(v), label: v + '%' }; }));
    refreshCurrencies();
    refreshCatalog();
    refreshManagers();
    onCompanyChange();
    onPaymentChange();
  });
}

function refreshCurrencies() {
  var current = $('#currency').value;
  fillSelect($('#currency'), ref.currencies.map(function (c) {
    return { value: c.code, label: c.label + ' (' + c.code + ')' };
  }), current || 'RUB');
}

function refreshManagers() {
  var list = $('#managers-list');
  list.innerHTML = '';
  ref.managers.forEach(function (manager) {
    var o = document.createElement('option');
    o.value = manager.name;
    list.appendChild(o);
  });
}

// Единицы измерения приходят справочником с сервера, «шт.» — по умолчанию.
function unitOptions(current) {
  var units = (ref.units && ref.units.length) ? ref.units : ['шт.'];
  var selected = current || units[0];
  return units.map(function (unit) {
    return '<option value="' + esc(unit) + '"' +
      (unit === selected ? ' selected' : '') + '>' + esc(unit) + '</option>';
  }).join('');
}

function refreshCatalog() {
  var list = $('#catalog-list');
  list.innerHTML = '';
  ref.catalog.forEach(function (item) {
    var o = document.createElement('option');
    o.value = item.name;
    o.dataset.payload = JSON.stringify(item);
    list.appendChild(o);
  });
}

// --- Реакции формы ------------------------------------------------------

function currentCompany() {
  var id = $('#company').value;
  for (var i = 0; i < ref.companies.length; i++) {
    if (ref.companies[i].id === id) { return ref.companies[i]; }
  }
  return null;
}

function currentTerm() {
  var id = $('#paymentTerms').value;
  for (var i = 0; i < ref.paymentTerms.length; i++) {
    if (ref.paymentTerms[i].id === id) { return ref.paymentTerms[i]; }
  }
  return null;
}

// Выбор компании задаёт ставку НДС и то, участвует ли логистика в цене.
function onCompanyChange() {
  var company = currentCompany();
  if (!company) { return; }
  $('#vatRate').value = String(company.vatRate);
  // Нумерация сквозная в пределах компании, поэтому при смене поставщика
  // номер пересчитывается — если менеджер не вписал свой.
  fillNextNumber();
  // Основание печатается только в счетах ООО.
  $('#basisWrap').hidden = company.id !== 'ooo';
  $('#company-hint').textContent =
    'Коэффициент ' + company.coefficient + ', НДС ' + company.vatRate + '% (в том числе). ' +
    (company.includeLogistics
      ? 'Доставка и страховка входят в расчёт цены.'
      : 'Доставка и страховка в расчёт цены не входят.');
  schedulePreview();
}

function onPaymentChange() {
  var term = currentTerm();
  var custom = $('#paymentTerms').value === 'custom';
  $('#paymentCustomWrap').hidden = !custom;
  if (term && term.minMarkup) {
    $('#markup-hint').textContent = 'Минимальная наценка для этих условий — ' + term.minMarkup + '. Больше можно, меньше нельзя.';
    var markup = $('#markup');
    if (!markup.value || Number(markup.value.replace(',', '.')) < term.minMarkup) {
      markup.value = String(term.minMarkup);
    }
  } else {
    $('#markup-hint').textContent = 'Для своего варианта оплаты минимальная наценка не задана.';
  }
  schedulePreview();
}

function onCurrencyChange() {
  var isRub = $('#currency').value === 'RUB';
  var rate = $('#rate');
  rate.disabled = isRub;
  if (isRub) { rate.value = '1'; }
  schedulePreview();
}

function fillNextNumber() {
  if (numberTouched || editingId) {
    return;
  }
  fetch('/api/next-number?company=' + encodeURIComponent($('#company').value))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!numberTouched && !editingId) {
        $('#number').value = data.number;
      }
    });
}

// --- Позиции ------------------------------------------------------------

function itemTemplate(data) {
  data = data || {};
  var lead = data.leadTime || { mode: 'weeks', weeks: 1, from: 1, to: 2, text: '' };
  var node = document.createElement('div');
  node.className = 'item';
  node.innerHTML =
    '<div class="item__head">' +
      '<span class="item__no"></span>' +
      '<button type="button" class="btn btn--icon" data-act="remove">Удалить</button>' +
    '</div>' +
    '<div class="item__grid">' +
      '<label class="span2">Наименование<input data-field="name" list="catalog-list" value="' + esc(data.name) + '"></label>' +
      '<label>Артикул<input data-field="sku" value="' + esc(data.sku) + '"></label>' +
      '<label>Ед.<select data-field="unit">' + unitOptions(data.unit) + '</select></label>' +
      '<label>Срок поставки<select data-field="leadMode">' +
        '<option value="weeks">Недель (1–12)</option>' +
        '<option value="range">Диапазон от–до</option>' +
        '<option value="custom">Свой вариант</option>' +
      '</select></label>' +
      '<label data-lead="weeks">Недель<input type="number" min="1" max="12" step="1" data-field="leadWeeks" value="' + (lead.weeks || 1) + '"></label>' +
      '<label data-lead="range">От, нед.<input type="number" min="0" step="1" data-field="leadFrom" value="' + (lead.from || 1) + '"></label>' +
      '<label data-lead="range">До, нед.<input type="number" min="0" step="1" data-field="leadTo" value="' + (lead.to || 2) + '"></label>' +
      '<label data-lead="custom" class="span2">Текст срока<input data-field="leadText" value="' + esc(lead.text) + '"></label>' +
      '<label>Кол-во, шт<input inputmode="decimal" data-field="qty" value="' + (data.qty || 1) + '"></label>' +
      '<label>Цена закупа<input inputmode="decimal" data-field="purchasePrice" value="' + (data.purchasePrice || 0) + '"></label>' +
      '<label data-logistics>Доставка, ₽<input inputmode="decimal" data-field="delivery" value="' + (data.delivery || 0) + '"></label>' +
      '<label data-logistics>Страховка, ₽<input inputmode="decimal" data-field="insurance" value="' + (data.insurance || 0) + '"></label>' +
      '<label>Вес, кг<input inputmode="decimal" data-field="weight" value="' + (data.weight || 0) + '"></label>' +
      '<label data-markup-individual>Наценка позиции<input inputmode="decimal" data-field="markup" value="' + (data.markup || '') + '"></label>' +
      '<div class="item__calc"></div>' +
    '</div>';

  $('[data-field="leadMode"]', node).value = lead.mode || 'weeks';
  syncLeadMode(node);
  return node;
}

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function syncLeadMode(node) {
  var mode = $('[data-field="leadMode"]', node).value;
  Array.prototype.forEach.call(node.querySelectorAll('[data-lead]'), function (el) {
    el.hidden = el.getAttribute('data-lead') !== mode;
  });
}

function syncItemVisibility() {
  var company = currentCompany();
  var individual = $('#markupMode').value === 'individual';
  Array.prototype.forEach.call(document.querySelectorAll('[data-logistics]'), function (el) {
    el.hidden = !(company && company.includeLogistics);
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-markup-individual]'), function (el) {
    el.hidden = !individual;
  });
  renumberItems();
}

function renumberItems() {
  Array.prototype.forEach.call(document.querySelectorAll('.item'), function (node, i) {
    $('.item__no', node).textContent = 'Позиция ' + (i + 1);
  });
}

function addItem(data) {
  $('#items').appendChild(itemTemplate(data));
  syncItemVisibility();
  schedulePreview();
}

function readItems() {
  return Array.prototype.map.call(document.querySelectorAll('.item'), function (node) {
    var get = function (field) {
      var el = $('[data-field="' + field + '"]', node);
      return el ? el.value : '';
    };
    return {
      name: get('name'), sku: get('sku'), unit: get('unit'),
      qty: get('qty'), purchasePrice: get('purchasePrice'),
      delivery: get('delivery'), insurance: get('insurance'),
      markup: get('markup'), weight: get('weight'),
      leadTime: {
        mode: get('leadMode'), weeks: get('leadWeeks'),
        from: get('leadFrom'), to: get('leadTo'), text: get('leadText')
      }
    };
  });
}

// --- Сбор и отправка ----------------------------------------------------

function collect() {
  var payload = { items: readItems(), client: {} };
  Array.prototype.forEach.call(document.querySelectorAll('#form [name]'), function (el) {
    var path = el.getAttribute('name').split('.');
    if (path.length === 2) {
      payload[path[0]] = payload[path[0]] || {};
      payload[path[0]][path[1]] = el.value;
    } else {
      payload[path[0]] = el.value;
    }
  });
  return payload;
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(preview, 250);
}

// Печатная форма под формой ввода. Обновляем только при реальном изменении
// разметки: иначе iframe перерисовывается на каждое нажатие и мигает.
function updatePreview() {
  fetch('/api/preview/html', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collect())
  }).then(function (r) { return r.text(); }).then(function (html) {
    if (html !== lastPreviewHtml) {
      lastPreviewHtml = html;
      $('#preview-frame').srcdoc = html;
    }
  });
}

function preview() {
  updatePreview();
  fetch('/api/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collect())
  }).then(function (r) { return r.json(); }).then(function (data) {
    renderTotals(data.totals, data.invoice);
    renderErrors(data.errors);
    renderItemCalcs(data.totals);
  });
}

function renderTotals(totals, invoice) {
  $('#totals').innerHTML =
    row('Позиций', String(totals.count)) +
    row('Общий вес', money.format(totals.weight) + ' кг') +
    row('Без НДС', money.format(totals.withoutVat) + ' ₽') +
    row('В том числе НДС ' + invoice.vatRate + '%', money.format(totals.vat) + ' ₽') +
    '<div class="grand"><span>Всего к оплате</span><span>' + money.format(totals.total) + ' ₽</span></div>';
}

function row(label, value) {
  return '<div><span>' + esc(label) + '</span><span>' + esc(value) + '</span></div>';
}

function renderErrors(errors) {
  $('#errors').innerHTML = (errors || []).map(function (msg) {
    return '<div>' + esc(msg) + '</div>';
  }).join('');
}

function renderItemCalcs(totals) {
  Array.prototype.forEach.call(document.querySelectorAll('.item'), function (node, i) {
    var line = totals.lines[i];
    var box = $('.item__calc', node);
    if (!line) { box.textContent = ''; return; }
    box.innerHTML =
      'Закуп ' + money.format(line.purchaseRub) + ' ₽' +
      (line.logistics ? ' + логистика ' + money.format(line.logistics) + ' ₽' : '') +
      ' → себестоимость ' + money.format(line.cost) + ' ₽' +
      ' × наценка ' + line.appliedMarkup +
      ' = <b>' + money.format(line.unitPrice) + ' ₽/ед</b>, сумма <b>' + money.format(line.sum) + ' ₽</b>';
  });
}

function save() {
  var payload = collect();
  var url = editingId ? '/api/invoices/' + editingId : '/api/invoices';
  fetch(url, {
    method: editingId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function (r) {
    return r.json().then(function (data) { return { ok: r.ok, data: data }; });
  }).then(function (res) {
    if (!res.ok) {
      renderErrors(res.data.errors || ['Не удалось сохранить счёт.']);
      $('#result').innerHTML = '';
      return;
    }
    editingId = res.data.id;
    renderErrors([]);
    $('#result').innerHTML =
      '<div class="ok">Счёт сохранён. Ссылку можно отправлять клиенту — она остаётся рабочей после правок.</div>' +
      '<div><a href="' + res.data.url + '" target="_blank">' + res.data.url + '</a></div>' +
      '<div style="margin-top:8px"><a href="' + res.data.pdf + '">Скачать PDF</a></div>';
  });
}

// --- Сохранённые счета --------------------------------------------------

function openList() {
  fetch('/api/invoices').then(function (r) { return r.json(); }).then(function (list) {
    $('#modal-title').textContent = 'Сохранённые счета';
    if (!list.length) {
      $('#modal-body').innerHTML = '<p class="hint">Пока ничего не сохранено.</p>';
    } else {
      var isAdmin = me.role === 'admin';
      $('#modal-body').innerHTML =
        '<table class="list"><thead><tr><th>№</th><th>Дата</th><th>Клиент</th><th>Компания</th>' +
        (isAdmin ? '<th>Автор</th>' : '') +
        '<th class="num">Сумма</th><th></th></tr></thead><tbody>' +
        list.map(function (inv) {
          return '<tr>' +
            '<td>' + esc(inv.number || '—') + '</td>' +
            '<td>' + esc(inv.docDate) + '</td>' +
            '<td>' + esc(inv.client) + '</td>' +
            '<td>' + esc(inv.company) + '</td>' +
            (isAdmin ? '<td>' + esc(inv.owner || '—') + '</td>' : '') +
            '<td class="num">' + money.format(inv.total) + ' ₽</td>' +
            '<td class="num">' +
              '<button type="button" class="btn btn--ghost" data-edit="' + inv.id + '">Редактировать</button> ' +
              '<a class="btn btn--ghost" href="' + inv.url + '" target="_blank">Открыть</a>' +
            '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    $('#modal').hidden = false;
  });
}

function loadForEdit(id) {
  fetch('/api/invoices/' + id).then(function (r) { return r.json(); }).then(function (data) {
    var inv = data.invoice;
    editingId = inv.id;
    numberTouched = true;
    Array.prototype.forEach.call(document.querySelectorAll('#form [name]'), function (el) {
      var path = el.getAttribute('name').split('.');
      var value = path.length === 2 ? (inv[path[0]] || {})[path[1]] : inv[path[0]];
      if (value !== undefined && value !== null) { el.value = value; }
    });
    $('#items').innerHTML = '';
    inv.items.forEach(addItem);
    onCompanyChange();
    onPaymentChange();
    onCurrencyChange();
    syncItemVisibility();
    $('#modal').hidden = true;
    $('#result').innerHTML = '<div class="ok">Редактируется счёт по ссылке ' + esc(data.url) + '</div>';
    schedulePreview();
  });
}

// --- Пользователи (администратор) ----------------------------------------

function openUsers() {
  fetch('/api/users').then(function (r) { return r.json(); }).then(function (data) {
    $('#modal-title').textContent = 'Пользователи';
    var roleOptions = data.roles.map(function (r) {
      return '<option value="' + esc(r.id) + '">' + esc(r.label) + '</option>';
    }).join('');

    var rows = data.users.map(function (u) {
      var label = (data.roles.filter(function (r) { return r.id === u.role; })[0] || {}).label || u.role;
      return '<tr>' +
        '<td>' + esc(u.login) + '</td>' +
        '<td>' + esc(u.name || '—') + '</td>' +
        '<td>' + esc(label) + '</td>' +
        '<td class="num">' +
          '<button type="button" class="btn btn--ghost" data-passwd="' + esc(u.login) + '">Сменить пароль</button> ' +
          (u.login === me.login ? '' :
            '<button type="button" class="btn btn--icon" data-remove="' + esc(u.login) + '">Удалить</button>') +
        '</td></tr>';
    }).join('');

    $('#modal-body').innerHTML =
      (data.users.length ? '' :
        '<div class="notice">Пользователей ещё нет — работает запасная учётная запись из ' +
        '<code>/etc/kp-ae.env</code>. Как только вы заведёте первого пользователя, ' +
        'она перестанет действовать, поэтому начните с администратора для себя.</div>') +
      '<table class="list"><thead><tr><th>Логин</th><th>Имя</th><th>Роль</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="userform">' +
        '<label>Логин<input id="new-login" placeholder="ivan"></label>' +
        '<label>Имя<input id="new-name" placeholder="Иван Петров"></label>' +
        '<label>Роль<select id="new-role">' + roleOptions + '</select></label>' +
        '<label>Пароль<input id="new-password" placeholder="оставьте пустым — сгенерируется"></label>' +
        '<div class="wide"><button type="button" class="btn btn--primary" id="btn-add-user">Добавить пользователя</button></div>' +
        '<div class="wide" id="user-result"></div>' +
      '</div>';
    // По умолчанию — наименьшие права: администратора назначают осознанно.
    $('#new-role').value = 'manager';
    $('#modal').hidden = false;
  });
}

function randomPassword() {
  var alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = '';
  var bytes = new Uint8Array(14);
  window.crypto.getRandomValues(bytes);
  for (var i = 0; i < bytes.length; i++) {
    out += alphabet.charAt(bytes[i] % alphabet.length);
  }
  return out;
}

function saveUser(payload, generated) {
  return fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function (r) {
    return r.json().then(function (data) { return { ok: r.ok, data: data }; });
  }).then(function (res) {
    if (!res.ok) {
      $('#user-result').innerHTML = '<div class="errors">' +
        (res.data.errors || ['Не удалось сохранить.']).map(esc).join('<br>') + '</div>';
      return;
    }
    openUsers();
    // Пароль показываем один раз: на сервере он хранится только хешем и
    // подсмотреть его потом будет негде.
    setTimeout(function () {
      $('#user-result').innerHTML = '<div class="notice">Логин <b>' + esc(payload.login) +
        '</b>, пароль <b>' + esc(generated) + '</b><br>Передайте их сотруднику — ' +
        'больше пароль нигде не отобразится.</div>';
    }, 100);
  });
}

function resetForm() {
  editingId = null;
  numberTouched = false;
  $('#form').reset();
  $('#items').innerHTML = '';
  $('#result').innerHTML = '';
  $('#docDate').value = new Date().toISOString().slice(0, 10);
  // form.reset() возвращает select к первому варианту, поэтому дефолты
  // проставляются явно — иначе условия оплаты «уезжают» на отсрочку.
  $('#paymentTerms').value = 'prepay100';
  $('#currency').value = 'RUB';
  $('#markupMode').value = 'all';
  onCompanyChange();
  onPaymentChange();
  onCurrencyChange();
  addItem();
}

// --- Импорт номенклатуры и валюты ---------------------------------------

function importCsv(file) {
  var reader = new FileReader();
  reader.onload = function () {
    fetch('/api/catalog/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: reader.result
    }).then(function (r) { return r.json(); }).then(function (data) {
      ref.catalog = data.catalog;
      refreshCatalog();
      alert('Загружено позиций: ' + data.imported);
    });
  };
  reader.readAsText(file, 'utf-8');
}

function addCurrency() {
  var code = prompt('Код валюты (например, TRY):');
  if (!code) { return; }
  var label = prompt('Название валюты:', code) || code;
  fetch('/api/currencies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code, label: label })
  }).then(function (r) { return r.json(); }).then(function (data) {
    ref.currencies = data.currencies;
    refreshCurrencies();
    $('#currency').value = code.toUpperCase();
    onCurrencyChange();
  });
}

// Тот же формат, что и на сервере: показываем результат сразу, не дожидаясь
// сохранения, чтобы менеджер видел, каким номер уйдёт в документ.
function formatPhoneField(el) {
  var raw = String(el.value || '').trim();
  var digits = raw.replace(/\D/g, '');
  if (!digits) { el.value = ''; return; }
  if (digits.charAt(0) === '8') { digits = '7' + digits.slice(1); }
  if (digits.length === 10) { digits = '7' + digits; }
  if (digits.charAt(0) !== '7' || digits.length !== 11) { return; }
  el.value = '+7 (' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) +
    '-' + digits.slice(7, 9) + '-' + digits.slice(9, 11);
}

// --- Привязки -----------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  loadMe().then(loadReference).then(resetForm);

  $('#company').addEventListener('change', function () { onCompanyChange(); syncItemVisibility(); });
  $('#paymentTerms').addEventListener('change', onPaymentChange);
  $('#deliveryTerms').addEventListener('change', function () {
    $('#deliveryCustomWrap').hidden = this.value !== 'custom';
    schedulePreview();
  });
  $('#currency').addEventListener('change', onCurrencyChange);
  $('#markupMode').addEventListener('change', function () { syncItemVisibility(); schedulePreview(); });

  $('#btn-add-item').addEventListener('click', function () { addItem(); });
  $('#btn-save').addEventListener('click', save);
  $('#btn-new').addEventListener('click', resetForm);
  $('#btn-list').addEventListener('click', openList);
  $('#btn-users').addEventListener('click', openUsers);
  $('#modal-close').addEventListener('click', function () { $('#modal').hidden = true; });
  $('#btn-add-currency').addEventListener('click', addCurrency);
  $('#btn-import').addEventListener('click', function () { $('#import-file').click(); });
  $('#import-file').addEventListener('change', function () {
    if (this.files[0]) { importCsv(this.files[0]); }
    this.value = '';
  });

  $('#items').addEventListener('click', function (ev) {
    if (ev.target.dataset.act === 'remove') {
      ev.target.closest('.item').remove();
      renumberItems();
      schedulePreview();
    }
  });

  $('#items').addEventListener('change', function (ev) {
    if (ev.target.dataset.field === 'leadMode') {
      syncLeadMode(ev.target.closest('.item'));
    }
    // Подстановка из справочника: имя выбрано из списка — тянем цену и вес.
    if (ev.target.dataset.field === 'name') {
      var match = ref.catalog.filter(function (i) { return i.name === ev.target.value; })[0];
      if (match) {
        var node = ev.target.closest('.item');
        var set = function (field, value) {
          var el = $('[data-field="' + field + '"]', node);
          if (el && !el.value) { el.value = value; }
        };
        set('sku', match.sku);
        set('unit', match.unit);
        set('purchasePrice', match.purchasePrice);
        set('weight', match.weight);
      }
    }
    schedulePreview();
  });

  $('#number').addEventListener('input', function () { numberTouched = true; });

  // Выбрали известного менеджера — подставляем его телефон и почту.
  $('#managerName').addEventListener('change', function () {
    var match = ref.managers.filter(function (m) { return m.name === this.value; }, this)[0];
    if (!match) { return; }
    var phone = document.querySelector('[name="manager.phone"]');
    var email = document.querySelector('[name="manager.email"]');
    if (!phone.value) { phone.value = match.phone || ''; }
    if (!email.value) { email.value = match.email || ''; }
    schedulePreview();
  });
  Array.prototype.forEach.call(
    document.querySelectorAll('input[name="client.phone"], input[name="manager.phone"]'),
    function (el) {
      el.addEventListener('blur', function () { formatPhoneField(el); schedulePreview(); });
    }
  );

  $('#form').addEventListener('input', schedulePreview);
  $('#form').addEventListener('submit', function (ev) { ev.preventDefault(); save(); });

  $('#modal-body').addEventListener('click', function (ev) {
    var t = ev.target;
    if (t.dataset.edit) { loadForEdit(t.dataset.edit); return; }

    if (t.id === 'btn-add-user') {
      var password = $('#new-password').value.trim() || randomPassword();
      saveUser({
        login: $('#new-login').value.trim(),
        name: $('#new-name').value.trim(),
        role: $('#new-role').value,
        password: password
      }, password);
      return;
    }

    if (t.dataset.passwd) {
      var fresh = randomPassword();
      saveUser({ login: t.dataset.passwd, password: fresh }, fresh);
      return;
    }

    if (t.dataset.remove) {
      if (!window.confirm('Удалить пользователя ' + t.dataset.remove + '?')) { return; }
      fetch('/api/users/' + encodeURIComponent(t.dataset.remove), { method: 'DELETE' })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (!res.ok) { window.alert((res.data.errors || ['Не удалось удалить.']).join('\n')); }
          openUsers();
        });
    }
  });
});
