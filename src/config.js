import dotenv from "dotenv";

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }

  return value;
}

const tochkaNotifyChatId = process.env.TOCHKA_NOTIFY_CHAT_ID || "";

export const config = {
  botToken: requireEnv("BOT_TOKEN"),
  spreadsheetId: requireEnv("GOOGLE_SHEETS_SPREADSHEET_ID"),
  serviceAccountEmail: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  privateKey: requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5-mini",
  defaultTimezone: process.env.DEFAULT_TIMEZONE || "Europe/Moscow",

  // ─── Точка Банк (webhook) ─────────────────────────────────────────────────
  // Включается, если задан TOCHKA_NOTIFY_CHAT_ID.
  // Точка подписывает webhook'и своим RSA-ключом — секрет нам не нужен,
  // публичный ключ забираем с https://enter.tochka.com/doc/openapi/static/keys/public
  tochkaEnabled: Boolean(tochkaNotifyChatId),

  // Telegram chat ID, куда слать уведомления о поступлениях (узнать у @userinfobot).
  tochkaNotifyChatId,

  // Опционально — JWT для регистрации webhook через API Точки (см. tools/registerWebhook.js).
  // В рантайме боту не нужен.
  tochkaJwtToken: process.env.TOCHKA_JWT_TOKEN || "",
  tochkaCustomerCode: process.env.TOCHKA_CUSTOMER_CODE || "",

  // Порт HTTP-сервера. На Railway PORT задаётся автоматически, локально — 3000.
  webhookPort: Number(process.env.PORT) || 3000
};
