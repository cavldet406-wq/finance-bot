/**
 * Webhook-обработчик входящих платежей от Точки.
 *
 * Спецификация Точки:
 * - POST с Content-Type: text/plain
 * - Body = JWT-токен (RS256)
 * - Подпись проверяется RSA-публичным ключом с https://enter.tochka.com/doc/openapi/static/keys/public
 * - Точка ожидает HTTP 200, иначе ретраит
 * - При регистрации шлёт тестовый webhook — мы возвращаем 200 на любую валидную подпись
 *
 * Поддерживаемые webhookType:
 *  - incomingPayment            — поступление на р/с
 *  - incomingSbpPayment         — входящий СБП
 *  - incomingSbpB2BPayment      — входящий СБП B2B
 *  - acquiringInternetPayment   — эквайринг (интернет-оплата)
 *
 * Безопасность:
 * - JWT-подпись проверяется ДО парсинга и до сайд-эффектов
 * - timingSafeEqual через crypto.verify (нативный, без вектор для timing-атак)
 * - Тело ограничено 1 МБ
 * - Дедупликация по paymentId — Точка ретраит при сбоях
 */

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { appendTransactions } from "./sheets.js";
import { normalizeTransactionShape } from "./parser.js";
import {
  extractAmount,
  extractCounterparty,
  extractDate,
  extractDescription,
  extractId
} from "./tochkaClient.js";
import { sanitizeError, escapeMarkdown } from "./security.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "tochka-webhook-state.json");
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SEEN_IDS = 5000;
const WEBHOOK_PATH = "/webhooks/tochka";
const PUBLIC_KEY_URL = "https://enter.tochka.com/doc/openapi/static/keys/public";

const INCOMING_TYPES = new Set([
  "incomingPayment",
  "incomingSbpPayment",
  "incomingSbpB2BPayment",
  "acquiringInternetPayment"
]);

// ─── State (дедупликация по paymentId) ────────────────────────────────────────

let seenIdsCache = null;

async function loadSeenIds() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed.seenIds) ? parsed.seenIds : []);
  } catch {
    return new Set();
  }
}

async function saveSeenIds(seenIds) {
  const trimmed = [...seenIds].slice(-MAX_SEEN_IDS);
  await fs.writeFile(
    STATE_FILE,
    JSON.stringify({ seenIds: trimmed, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

async function getSeenIds() {
  if (!seenIdsCache) {
    seenIdsCache = await loadSeenIds();
  }
  return seenIdsCache;
}

// ─── Публичный ключ Точки ─────────────────────────────────────────────────────

let publicKeyCache = null;

/**
 * Загружаем публичный RSA-ключ Точки. Кэшируем — он стабильный.
 * Поддерживаем PEM и JWK форматы (на случай изменений на стороне Точки).
 */
async function loadPublicKey() {
  if (publicKeyCache) return publicKeyCache;

  const response = await fetch(PUBLIC_KEY_URL);

  if (!response.ok) {
    throw new Error(`Не удалось загрузить публичный ключ Точки: HTTP ${response.status}`);
  }

  const text = (await response.text()).trim();

  // Случай 1: PEM
  if (text.startsWith("-----BEGIN")) {
    publicKeyCache = crypto.createPublicKey(text);
    return publicKeyCache;
  }

  // Случай 2: JWK / JWKS
  try {
    const json = JSON.parse(text);
    const jwk = json.keys ? json.keys[0] : json;
    publicKeyCache = crypto.createPublicKey({ key: jwk, format: "jwk" });
    return publicKeyCache;
  } catch {
    throw new Error("Публичный ключ Точки в неизвестном формате (не PEM и не JWK)");
  }
}

// ─── Верификация JWT (RS256) на нативном crypto ──────────────────────────────

/**
 * Проверяем подпись JWT и возвращаем декодированный payload, либо null если невалиден.
 * Используется только RS256 — других алгоритмов Точка не присылает.
 */
function verifyJwtRs256(token, publicKey) {
  const parts = String(token).trim().split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  // Защита от alg=none и подмены алгоритма
  if (header.alg !== "RS256") {
    return null;
  }

  const signedData = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(signatureB64, "base64url");

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signedData);
  verifier.end();

  const valid = verifier.verify(publicKey, signature);

  if (!valid) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// ─── Чтение тела запроса с лимитом ────────────────────────────────────────────

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let aborted = false;

    req.on("data", (chunk) => {
      if (aborted) return;
      total += chunk.length;

      if (total > MAX_BODY_BYTES) {
        aborted = true;
        reject(new Error("Webhook body too large"));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

// ─── Бизнес-логика ────────────────────────────────────────────────────────────

function buildSheetTransaction(payload) {
  const description = extractDescription(payload);
  const amount = extractAmount(payload);
  const date = extractDate(payload);

  return normalizeTransactionShape({
    rawText: description,
    transactionDate: date,
    direction: "income",
    category: "Выручка",
    pnlGroup: "Выручка",
    description: `${extractCounterparty(payload)} — ${description}`.slice(0, 200),
    amount,
    currency: payload.SidePayer?.currency || "RUB"
  });
}

function buildTelegramMessage(payload) {
  const counterparty = escapeMarkdown(extractCounterparty(payload));
  const amount = extractAmount(payload);
  const amountFormatted = amount.toLocaleString("ru-RU");
  const purpose = escapeMarkdown(extractDescription(payload));

  return [
    "💳 *Новое поступление на Р/С*",
    `От: ${counterparty}`,
    `Сумма: ${amountFormatted} ₽`,
    purpose && purpose !== "Поступление на р/с" ? `Назначение: ${purpose}` : null,
    "Добавил в таблицу ✅"
  ]
    .filter(Boolean)
    .join("\n");
}

async function processIncomingPayment(bot, payload) {
  const paymentId = extractId(payload);
  const seenIds = await getSeenIds();

  if (paymentId && seenIds.has(paymentId)) {
    console.log(`[Tochka] Webhook повтор, игнорируем: ${paymentId}`);
    return;
  }

  const sheetTx = buildSheetTransaction(payload);
  await appendTransactions([sheetTx], { source: "Точка Банк (webhook)" });

  if (config.tochkaNotifyChatId) {
    const message = buildTelegramMessage(payload);
    await bot.telegram.sendMessage(config.tochkaNotifyChatId, message, {
      parse_mode: "Markdown"
    });
  }

  if (paymentId) {
    seenIds.add(paymentId);
    await saveSeenIds(seenIds);
  }

  console.log(
    `[Tochka] Обработано поступление ${paymentId || "(без id)"}: ${extractAmount(payload)} ₽ от ${extractCounterparty(payload)}`
  );
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

async function handleWebhook(bot, req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return;
  }

  // Читаем тело
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error("[Tochka] Не смог прочитать тело webhook:", sanitizeError(err));
    res.writeHead(413, { "Content-Type": "text/plain" });
    res.end("Payload Too Large");
    return;
  }

  // Загружаем публичный ключ (с кэшем)
  let publicKey;
  try {
    publicKey = await loadPublicKey();
  } catch (err) {
    console.error("[Tochka] Не удалось загрузить публичный ключ:", sanitizeError(err));
    // Без ключа не можем проверить — отдаём 503, Точка ретраит
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("Service Unavailable");
    return;
  }

  // Тело webhook'а — JWT-токен в plain text
  const token = rawBody.toString("utf8").trim();
  const payload = verifyJwtRs256(token, publicKey);

  if (!payload) {
    console.warn("[Tochka] Webhook отклонён: невалидная JWT-подпись");
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("Unauthorized");
    return;
  }

  // Подпись валидна — Точка ждёт 200 как можно быстрее.
  // Дальнейшая обработка идёт асинхронно, не блокирует ответ.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));

  // Тестовый webhook от Точки (при регистрации/проверке) — может прийти
  // с минимальным payload или специальным типом. Главное — мы вернули 200.
  const webhookType = payload.webhookType;

  if (!webhookType) {
    console.log("[Tochka] Webhook без webhookType — вероятно тестовый, OK");
    return;
  }

  if (!INCOMING_TYPES.has(webhookType)) {
    console.log(`[Tochka] Webhook типа ${webhookType} — пропускаем (не входящий платёж)`);
    return;
  }

  try {
    await processIncomingPayment(bot, payload);
  } catch (err) {
    console.error("[Tochka] Ошибка при обработке поступления:", sanitizeError(err));
  }
}

// ─── Запуск сервера ───────────────────────────────────────────────────────────

export function startTochkaWebhookServer(bot) {
  if (!config.tochkaEnabled) {
    console.log("[Tochka] Webhook не запущен — задайте TOCHKA_NOTIFY_CHAT_ID в .env");
    return null;
  }

  const port = config.webhookPort;

  const server = http.createServer((req, res) => {
    // Health-check для Railway
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    if (req.url === WEBHOOK_PATH) {
      handleWebhook(bot, req, res).catch((err) => {
        console.error("[Tochka] Необработанная ошибка handler:", sanitizeError(err));
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal Server Error");
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  server.listen(port, () => {
    console.log(`[Tochka] Webhook server слушает порт ${port}, путь ${WEBHOOK_PATH}`);
  });

  // Прогреваем кэш публичного ключа при старте, чтобы первый webhook не тормозил
  loadPublicKey().catch((err) => {
    console.error("[Tochka] Ошибка предзагрузки публичного ключа:", sanitizeError(err));
  });

  return server;
}
