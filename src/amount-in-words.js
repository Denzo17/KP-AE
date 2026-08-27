// Сумма прописью для печатной формы счёта.
// Формат как в 1С: «Семь тысяч сто шестьдесят рублей 40 копеек» —
// рубли словами, копейки цифрами.

const ONES = [
  '', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять',
  'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
  'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'
];
const ONES_F = { 1: 'одна', 2: 'две' };
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
  'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот',
  'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

// Разряды: тысячи женского рода, остальные — мужского.
const GROUPS = [
  { forms: null, feminine: false },
  { forms: ['тысяча', 'тысячи', 'тысяч'], feminine: true },
  { forms: ['миллион', 'миллиона', 'миллионов'], feminine: false },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], feminine: false },
  { forms: ['триллион', 'триллиона', 'триллионов'], feminine: false }
];

export function plural(n, forms) {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 19) {
    return forms[2];
  }
  if (mod10 === 1) {
    return forms[0];
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return forms[1];
  }
  return forms[2];
}

function triadToWords(triad, feminine) {
  const words = [];
  const hundreds = Math.floor(triad / 100);
  const rest = triad % 100;

  if (hundreds) {
    words.push(HUNDREDS[hundreds]);
  }
  if (rest < 20) {
    if (rest) {
      words.push(feminine && ONES_F[rest] ? ONES_F[rest] : ONES[rest]);
    }
  } else {
    words.push(TENS[Math.floor(rest / 10)]);
    const ones = rest % 10;
    if (ones) {
      words.push(feminine && ONES_F[ones] ? ONES_F[ones] : ONES[ones]);
    }
  }
  return words;
}

export function integerToWords(value) {
  let n = Math.floor(Math.abs(value));
  if (n === 0) {
    return 'ноль';
  }

  const triads = [];
  while (n > 0) {
    triads.push(n % 1000);
    n = Math.floor(n / 1000);
  }

  const words = [];
  for (let i = triads.length - 1; i >= 0; i--) {
    const triad = triads[i];
    if (triad === 0) {
      continue;
    }
    const group = GROUPS[i] || GROUPS[GROUPS.length - 1];
    words.push(...triadToWords(triad, group.feminine));
    if (group.forms) {
      words.push(plural(triad, group.forms));
    }
  }
  return words.join(' ');
}

// «Семь тысяч сто шестьдесят рублей 40 копеек»
export function amountInWords(amount) {
  const rounded = Math.round(Math.abs(amount) * 100);
  const rubles = Math.floor(rounded / 100);
  const kopecks = rounded % 100;

  const words = integerToWords(rubles);
  const capitalized = words.charAt(0).toUpperCase() + words.slice(1);

  return `${capitalized} ${plural(rubles, ['рубль', 'рубля', 'рублей'])} ` +
    `${String(kopecks).padStart(2, '0')} ${plural(kopecks, ['копейка', 'копейки', 'копеек'])}`;
}
