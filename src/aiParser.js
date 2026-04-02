import OpenAI from "openai";
import { config } from "./config.js";
import { readMemory } from "./memory.js";
import { DEFAULT_PNL_GROUPS, getCategoryCatalog } from "./sheets.js";
import {
  normalizeTransactionShape
} from "./parser.js";

let client;

function getClient() {
  if (!config.openaiApiKey) {
    throw new Error("Не задан OPENAI_API_KEY");
  }

  if (!client) {
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }

  return client;
}

function extractJson(text) {
  const trimmed = text.trim();

  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const blockMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```([\s\S]*?)```/);

  if (blockMatch) {
    return blockMatch[1].trim();
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);

  if (!objectMatch) {
    throw new Error("Модель не вернула JSON");
  }

  return objectMatch[0];
}

function buildPrompt({ text, now, clarificationContext, memoryNotes, catalog }) {
  const categories = catalog.map((item) => item.category).join(", ");
  const pnlGroups = DEFAULT_PNL_GROUPS.join(", ");
  const currentDate = now.toISOString().slice(0, 10);
  const catalogText = catalog
    .map((item) => `- ${item.category} -> ${item.pnlGroup}${item.description ? ` (${item.description})` : ""}`)
    .join("\n");

  return [
    "Ты финансовый ассистент для учета бизнеса.",
    `Сегодня: ${currentDate}. Часовой пояс пользователя: ${config.defaultTimezone}.`,
    "Нужно разобрать сообщение пользователя и вернуть только JSON без пояснений.",
    "В одном сообщении может быть несколько операций. Каждую операцию нужно вынести отдельным объектом.",
    "Заголовки вроде 'Расходы за 1-ое апреля' или 'Поступления за вчера' задают общий контекст для всех строк ниже.",
    "Нужно определить для каждой операции:",
    "- дату",
    "- тип: income или expense",
    "- категорию",
    "- группу PNL",
    "- краткое понятное описание",
    "- сумму",
    "Если каких-то данных критически не хватает или есть существенная неоднозначность, НЕ угадывай.",
    "Вместо этого верни status=needs_clarification и задай один короткий уточняющий вопрос на русском.",
    "Спрашивай только то, без чего нельзя надежно записать операцию.",
    "Если все понятно, верни status=ready.",
    `category должна быть одной из: ${categories}.`,
    `pnlGroup должна быть одной из: ${pnlGroups}.`,
    "Используй этот справочник категорий как основной источник:",
    catalogText,
    "Если в памяти уже есть пользовательские пояснения по словам или сервисам, используй их как приоритетный контекст.",
    "Возвращай сумму положительным числом, валюта по умолчанию ₽.",
    'Формат ответа: {"status":"ready|needs_clarification","question":"...","memoryNotes":["..."],"transactions":[{"transactionDate":"YYYY-MM-DD","direction":"income|expense","category":"...","pnlGroup":"...","description":"...","amount":12345,"currency":"₽","sourceText":"..."}]}',
    memoryNotes.length ? `Память пользователя:\n- ${memoryNotes.join("\n- ")}` : "",
    clarificationContext ? `Контекст уточнения:\n${clarificationContext}` : "",
    `Сообщение пользователя:\n${text}`
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeAiTransactions(text, transactions) {
  return (transactions || []).map((transaction) =>
    normalizeTransactionShape({
      rawText: transaction.sourceText || text,
      transactionDate: transaction.transactionDate,
      direction: transaction.direction,
      category: transaction.category,
      pnlGroup: transaction.pnlGroup,
      description: transaction.description,
      amount: transaction.amount,
      currency: transaction.currency || "₽"
    })
  );
}

async function runAiParse({ text, now = new Date(), clarificationContext = "" }) {
  const openai = getClient();
  const memory = await readMemory();
  const catalog = await getCategoryCatalog();
  const response = await openai.responses.create({
    model: config.openaiModel,
    input: buildPrompt({
      text,
      now,
      clarificationContext,
      memoryNotes: memory.notes,
      catalog
    })
  });

  const parsed = JSON.parse(extractJson(response.output_text || ""));

  if (parsed.status === "needs_clarification") {
    return {
      status: "needs_clarification",
      question: parsed.question || "Уточните, пожалуйста, детали операции.",
      memoryNotes: Array.isArray(parsed.memoryNotes) ? parsed.memoryNotes : []
    };
  }

  return {
    status: "ready",
    memoryNotes: Array.isArray(parsed.memoryNotes) ? parsed.memoryNotes : [],
    transactions: normalizeAiTransactions(text, parsed.transactions).map((transaction) => ({
      ...transaction,
      parser: "openai"
    }))
  };
}

export async function analyzeTransactionMessage(text, now = new Date()) {
  return runAiParse({ text, now });
}

export async function analyzeTransactionClarification({
  originalText,
  clarificationTurns = [],
  clarificationText,
  now = new Date()
}) {
  const clarificationContext = [
    "Пользователь ранее отправил сообщение с операциями.",
    `Исходное сообщение:\n${originalText}`,
    clarificationTurns.length
      ? `История уточнений:\n${clarificationTurns
          .map(
            (turn) =>
              `Вопрос бота: ${turn.question}\nОтвет пользователя: ${turn.answer}`
          )
          .join("\n\n")}`
      : "",
    `Уточнение пользователя:\n${clarificationText}`,
    "Используй исходное сообщение и все ответы пользователя выше.",
    "Не задавай повторно вопрос о данных, которые уже есть в исходном сообщении или в истории уточнений."
  ].join("\n\n");

  return runAiParse({
    text: originalText,
    now,
    clarificationContext
  });
}
