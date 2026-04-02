export const ALLOWED_CATEGORIES = [
  "Выручка",
  "Себестоимость",
  "ФОТ",
  "Налоги",
  "Маркетинг",
  "Софт",
  "Подрядчики",
  "Аренда",
  "Прочие расходы"
];

export const ALLOWED_PNL_GROUPS = ["Выручка", "Себестоимость", "Операционные расходы"];

const CATEGORY_RULES = [
  {
    match: /(выручк|продаж|оплат[аы]|доход|поступлен)/i,
    category: "Выручка",
    pnlGroup: "Выручка"
  },
  {
    match: /(себестоим|себе стоимость|товар|закуп|производств|материал)/i,
    category: "Себестоимость",
    pnlGroup: "Себестоимость"
  },
  {
    match: /(зарплат|оклад|фоп|команд[ае]|бонус|менеджер|сотрудник)/i,
    category: "ФОТ",
    pnlGroup: "Операционные расходы"
  },
  {
    match: /(налог|ндс|усн|ип|ооо|взнос)/i,
    category: "Налоги",
    pnlGroup: "Операционные расходы"
  },
  {
    match: /(реклам|маркет|таргет|директ|meta|google ads|яндекс)/i,
    category: "Маркетинг",
    pnlGroup: "Операционные расходы"
  },
  {
    match: /(amo|амо|crm|срм|notion|chatgpt|openai|подписк|saas|сервис|zoom|slack)/i,
    category: "Софт",
    pnlGroup: "Операционные расходы"
  },
  {
    match: /(подряд|фриланс|дизайнер|разработчик|монтаж|агент|исполнител)/i,
    category: "Подрядчики",
    pnlGroup: "Операционные расходы"
  },
  {
    match: /(аренд|офис|склад|cowork)/i,
    category: "Аренда",
    pnlGroup: "Операционные расходы"
  }
];

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function parseNumber(rawAmount) {
  const cleaned = rawAmount
    .replace(/[₽рруб\.]/gi, (char) => (char === "." ? "." : ""))
    .replace(/\s/g, "")
    .replace(/,/g, ".");

  const sign = cleaned.startsWith("-") ? -1 : 1;
  const unsigned = cleaned.replace(/^[+-]/, "");
  const separators = [...unsigned.matchAll(/[.]/g)].length;

  let normalized = unsigned;

  if (separators > 1) {
    normalized = unsigned.replace(/\./g, "");
  } else if (separators === 1) {
    const [left, right] = unsigned.split(".");
    if (!right || right.length === 3) {
      normalized = `${left}${right || ""}`;
    }
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed === 0) {
    throw new Error("Не удалось распознать сумму");
  }

  return sign * parsed;
}

function extractAmount(text) {
  const match = text.match(/[+-]?\s*\d[\d\s.,]*\s*(?:₽|руб\.?|р\b)?/i);

  if (!match) {
    throw new Error("Не нашел сумму. Пример: -3000₽ за amo crm");
  }

  return {
    raw: match[0],
    value: parseNumber(match[0]),
    hasExplicitSign: /^[+-]/.test(match[0].trim())
  };
}

function extractDate(text, fallbackDate = new Date()) {
  const relativePatterns = [
    { match: /(^|\s)сегодня($|\s)/i, offsetDays: 0 },
    { match: /(^|\s)вчера($|\s)/i, offsetDays: -1 },
    { match: /(^|\s)позавчера($|\s)/i, offsetDays: -2 },
    { match: /(^|\s)(ровно\s+)?неделю\s+назад($|\s)/i, offsetDays: -7 }
  ];

  for (const pattern of relativePatterns) {
    if (pattern.match.test(text)) {
      const date = new Date(fallbackDate);
      date.setDate(date.getDate() + pattern.offsetDays);
      return date;
    }
  }

  const match = text.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);

  if (!match) {
    return fallbackDate;
  }

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = match[3]
    ? Number(match[3].length === 2 ? `20${match[3]}` : match[3])
    : fallbackDate.getFullYear();

  return new Date(year, month, day);
}

function detectDirection(text, amount) {
  if (amount.hasExplicitSign) {
    return amount.value > 0 ? "income" : "expense";
  }

  if (/(заплатил|оплатил|перевел|отдал|купил|списал|расход|выплатил)/i.test(text)) {
    return "expense";
  }

  if (/(получил|поступило|пришло|выручка|доход|оплата\s+от)/i.test(text)) {
    return "income";
  }

  return amount.value > 0 ? "income" : "expense";
}

function detectCategory(description, direction) {
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(description)) {
      return rule;
    }
  }

  if (direction === "income") {
    return {
      category: "Выручка",
      pnlGroup: "Выручка"
    };
  }

  return {
    category: "Прочие расходы",
    pnlGroup: "Операционные расходы"
  };
}

function resolvePnlGroup(category, direction) {
  if (direction === "income") {
    return "Выручка";
  }

  if (category === "Себестоимость") {
    return "Себестоимость";
  }

  return "Операционные расходы";
}

export function buildMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function buildMonthLabel(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1)));
}

export function normalizeTransactionShape({
  rawText,
  transactionDate,
  direction,
  category,
  pnlGroup,
  description,
  amount,
  currency = "RUB"
}) {
  const date =
    transactionDate instanceof Date ? transactionDate : new Date(transactionDate);

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("Не удалось распознать дату операции");
  }

  const normalizedDirection = direction === "income" ? "income" : "expense";
  const normalizedCategory =
    ALLOWED_CATEGORIES.includes(category)
      ? category
      : normalizedDirection === "income"
        ? "Выручка"
        : "Прочие расходы";
  const normalizedPnlGroup = ALLOWED_PNL_GROUPS.includes(pnlGroup)
    ? pnlGroup
    : resolvePnlGroup(normalizedCategory, normalizedDirection);
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Не удалось распознать сумму");
  }

  return {
    rawText: normalizeWhitespace(rawText),
    transactionDate: date,
    month: buildMonthDate(date),
    monthLabel: buildMonthLabel(date),
    direction: normalizedDirection === "income" ? "Доход" : "Расход",
    category: normalizedCategory,
    pnlGroup: normalizedPnlGroup,
    description: normalizeWhitespace(description || "Без описания"),
    amount: numericAmount,
    signedAmount: normalizedDirection === "income" ? numericAmount : -numericAmount,
    currency: currency === "RUB" ? "₽" : currency
  };
}

function cleanupDescription(text, rawAmount) {
  const withoutAmount = text.replace(rawAmount, "");
  const withoutDate = withoutAmount.replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/, "");
  const normalized = normalizeWhitespace(withoutDate)
    .replace(/^(за|на|по)\s+/i, "")
    .replace(/^[-+]\s*/, "");

  return normalized || "Без описания";
}

export function parseTransaction(text, now = new Date()) {
  const sourceText = normalizeWhitespace(text);
  const amount = extractAmount(sourceText);
  const date = extractDate(sourceText, now);
  const description = cleanupDescription(sourceText, amount.raw);
  const direction = detectDirection(sourceText, amount);
  const categoryInfo = detectCategory(description, direction);

  return normalizeTransactionShape({
    rawText: sourceText,
    transactionDate: date,
    direction,
    category: categoryInfo.category,
    pnlGroup: categoryInfo.pnlGroup,
    description,
    amount: Math.abs(amount.value),
    currency: "RUB"
  });
}
