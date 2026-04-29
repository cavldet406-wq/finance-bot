/**
 * Утилиты для защиты от утечек секретов в логах и сообщениях пользователю.
 *
 * Главные риски:
 * - Telegraf включает bot.token в URL HTTP запросов; если такой запрос упал,
 *   токен оказывается в `error.message`/`error.on.payload`.
 * - OpenAI SDK может приложить URL с api-key.
 * - Tochka API теоретически может echo'нуть headers в теле ответа.
 * - Markdown-спецсимволы в названии плательщика могут сломать parse_mode.
 */

const PATTERNS = [
  // Bearer / Authorization токены
  /\bBearer\s+[A-Za-z0-9._\-+/=]+/gi,
  // JWT (eyJ...)
  /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g,
  // Telegram bot token: 123456:ABC-DEF...
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g,
  // OpenAI keys
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  // Anthropic keys
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  // Generic api_key/api-key/access_token query params в URL
  /([?&](?:api[_-]?key|access[_-]?token|token|key)=)[^&\s]+/gi,
  // Google service account private key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
];

const REPLACEMENT = "[REDACTED]";

/**
 * Удаляет/маскирует все известные форматы секретов из строки.
 */
export function redactSecrets(value) {
  if (value === null || value === undefined) {
    return "";
  }

  let str = typeof value === "string" ? value : String(value);

  for (const pattern of PATTERNS) {
    if (pattern.source.includes("api[_-]?key|access")) {
      // Спец-кейс: query-param replacement сохраняет ключ параметра
      str = str.replace(pattern, `$1${REPLACEMENT}`);
    } else {
      str = str.replace(pattern, REPLACEMENT);
    }
  }

  return str;
}

/**
 * Безопасное сообщение об ошибке — без секретов и без stack trace,
 * с ограничением длины. Используй для логов и сообщений пользователю.
 */
export function sanitizeError(error, { maxLength = 500 } = {}) {
  if (!error) {
    return "Unknown error";
  }

  const message = typeof error === "string" ? error : (error.message || String(error));
  const redacted = redactSecrets(message);

  return redacted.length > maxLength
    ? `${redacted.slice(0, maxLength)}…`
    : redacted;
}

/**
 * Экранирует символы Markdown V1 (Telegram) в произвольной строке.
 * Используем для пользовательских данных (имя плательщика, описание),
 * чтобы они не сломали parse_mode и не позволили инъекцию форматирования.
 */
export function escapeMarkdown(value) {
  if (!value) return "";
  return String(value).replace(/([_*`\[\]])/g, "\\$1");
}

/**
 * Обрезает строку до maxLength символов с многоточием в конце.
 */
export function truncate(value, maxLength = 200) {
  const str = String(value || "");
  return str.length > maxLength ? `${str.slice(0, maxLength)}…` : str;
}
