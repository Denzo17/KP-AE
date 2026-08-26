// Реквизиты берутся из присланных образцов счетов (docx).
// Каждая компания несёт свои налоговые правила, поэтому выбор компании в
// форме автоматически задаёт коэффициент, ставку НДС и то, участвуют ли
// доставка со страховкой в расчёте цены.

export const COMPANIES = {
  ooo: {
    id: 'ooo',
    label: 'ООО «А-Э»',
    fullName: 'ООО "А-Э"',
    inn: '7806630804',
    kpp: '780601001',
    address:
      '195113, Город Санкт-Петербург, вн.тер. г. Муниципальный Округ Полюстрово, ' +
      'пр-кт Маршака, дом 12, корпус 2, литера А, квартира 58',
    bank: {
      name: 'Филиал "Центральный" Банка ВТБ (ПАО) г. Москва',
      bik: '044525411',
      corrAccount: '30101810145250000411',
      account: '40702810400810057645'
    },
    signer: { position: 'Руководитель', name: 'Лутонин А. В.' },
    // Налоговая логика ООО: коэффициент 1,5, НДС 22%, доставка и страховка
    // в расчёт цены не входят.
    coefficient: 1.5,
    vatRate: 22,
    includeLogistics: false
  },

  ip: {
    id: 'ip',
    label: 'ИП Лутонина Е. С.',
    fullName: 'Индивидуальный предприниматель Лутонина Евгения Сергеевна',
    inn: '471604664308',
    kpp: '',
    address: '',
    email: 'voltmeter@evolut-m.ru',
    site: 'https://evolut-m.ru',
    bank: {
      name: 'ООО "ОЗОН Банк" г Москва',
      bik: '044525068',
      corrAccount: '30101810645374525068',
      account: '40802810400000368020'
    },
    signer: { position: 'Индивидуальный предприниматель', name: 'Лутонина Е. С.' },
    // Налоговая логика ИП: коэффициент 1,2, НДС 5%, доставка и страховка
    // добавляются к закупочной цене.
    coefficient: 1.2,
    vatRate: 5,
    includeLogistics: true
  }
};

export function getCompany(id) {
  return COMPANIES[id] || COMPANIES.ooo;
}

export const COMPANY_LIST = Object.values(COMPANIES).map((c) => ({
  id: c.id,
  label: c.label,
  coefficient: c.coefficient,
  vatRate: c.vatRate,
  includeLogistics: c.includeLogistics
}));
