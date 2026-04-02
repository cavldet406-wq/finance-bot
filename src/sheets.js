import { google } from "googleapis";
import { config } from "./config.js";

const TRANSACTIONS_SHEET = "Transactions";
export const SHEET_NAMES = {
  operations: "Операции",
  categories: "Справочник",
  dds: "ДДС",
  pnl: "PNL",
  dashboard: "Дашборд"
};

export const LEGACY_SHEET_NAMES = {
  operations: "Transactions",
  dds: "DDS",
  pnl: "PNL",
  dashboard: "Dashboard"
};

export const DEFAULT_PNL_GROUPS = ["Выручка", "Себестоимость", "Операционные расходы"];

export const DEFAULT_CATEGORY_ROWS = [
  ["Выручка", "Выручка", "Поступления от клиентов, продажи", "Да"],
  ["Себестоимость", "Себестоимость", "Материалы, упаковка, производство", "Да"],
  ["ФОТ", "Операционные расходы", "Зарплаты, бонусы, выплаты сотрудникам", "Да"],
  ["Налоги", "Операционные расходы", "Налоги и обязательные взносы", "Да"],
  ["Маркетинг", "Операционные расходы", "Реклама, трафик, продвижение", "Да"],
  ["Софт", "Операционные расходы", "Подписки, CRM, сервисы, AI", "Да"],
  ["Подрядчики", "Операционные расходы", "Фрилансеры и агентства", "Да"],
  ["Аренда", "Операционные расходы", "Офис, склад, коворкинг", "Да"],
  ["Логистика", "Операционные расходы", "Доставка, пересылки, транспорт", "Да"],
  ["Банковские комиссии", "Операционные расходы", "Комиссии банка и эквайринг", "Да"],
  ["Прочие расходы", "Операционные расходы", "Все, что не попало в другие категории", "Да"]
];

function getAuth() {
  return new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: config.privateKey,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
}

export async function getSheetsClient() {
  const auth = getAuth();
  await auth.authorize();

  return google.sheets({ version: "v4", auth });
}

export async function appendTransaction(transaction, metadata = {}) {
  return appendTransactions([transaction], metadata);
}

export async function appendTransactions(transactions, metadata = {}) {
  const sheets = await getSheetsClient();
  const rows = transactions.map((transaction) => [
    new Date().toISOString(),
    formatDate(transaction.transactionDate),
    transaction.month,
    transaction.direction,
    transaction.category,
    transaction.pnlGroup,
    transaction.description,
    transaction.amount,
    transaction.signedAmount,
    transaction.currency,
    metadata.source || "Телеграм",
    transaction.rawText,
    metadata.user || "",
    metadata.chat || "",
    transaction.monthLabel || ""
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${SHEET_NAMES.operations}!A:O`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: rows
    }
  });
}

export async function getCategoryCatalog() {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${SHEET_NAMES.categories}!A2:D200`
  });

  const rows = response.data.values || [];
  const categories = rows
    .filter((row) => row[0] && (row[3] || "Да") !== "Нет")
    .map((row) => ({
      category: row[0],
      pnlGroup: row[1] || "Операционные расходы",
      description: row[2] || ""
    }));

  return categories.length ? categories : DEFAULT_CATEGORY_ROWS.map((row) => ({
    category: row[0],
    pnlGroup: row[1],
    description: row[2]
  }));
}

export function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
