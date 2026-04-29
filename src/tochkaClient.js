/**
 * Парсеры payload'а webhook от Точка Банка.
 *
 * Реальная схема (после JWT-декода):
 * {
 *   webhookType: "incomingPayment" | "incomingSbpPayment" | "incomingSbpB2BPayment" | "acquiringInternetPayment",
 *   paymentId: "uuid",
 *   date: "YYYY-MM-DD",
 *   purpose: "назначение платежа",
 *   documentNumber: "...",
 *   customerCode: "...",
 *   SidePayer:     { name, inn, kpp, account, bankCode, bankName, amount, currency },
 *   SideRecipient: { name, inn, kpp, account, bankCode, bankName, amount, currency }
 * }
 *
 * Для эквайринга и СБП формат может отличаться — поэтому каждый extractor
 * пробует несколько путей.
 */

/**
 * Имя плательщика. Для СБП-эквайринга может прийти просто как строка.
 */
export function extractCounterparty(payload) {
  const payer = payload.SidePayer || payload.payer || {};
  const name = payer.name || payer.Name || payload.payerName;

  if (name) {
    const inn = payer.inn || payer.Inn;
    return inn ? `${name} (ИНН ${inn})` : name;
  }

  return payload.merchantName || "Неизвестный плательщик";
}

/**
 * Назначение платежа.
 */
export function extractDescription(payload) {
  return (
    payload.purpose ||
    payload.Purpose ||
    payload.description ||
    payload.paymentPurpose ||
    "Поступление на р/с"
  );
}

/**
 * Сумма поступления (положительное число).
 * Берём из SidePayer.amount, fallback на SideRecipient или верхний уровень.
 */
export function extractAmount(payload) {
  const raw =
    payload.SidePayer?.amount ??
    payload.SideRecipient?.amount ??
    payload.amount ??
    payload.Amount?.Amount ??
    "0";

  return Math.abs(parseFloat(raw) || 0);
}

/**
 * Дата операции.
 */
export function extractDate(payload) {
  const raw =
    payload.date ||
    payload.Date ||
    payload.transactionDate ||
    payload.bookingDate ||
    payload.createdAt;

  return raw ? new Date(raw) : new Date();
}

/**
 * Уникальный ID платежа для дедупликации.
 * paymentId — поле, на которое указывает официальная документация.
 */
export function extractId(payload) {
  return (
    payload.paymentId ||
    payload.PaymentId ||
    payload.documentNumber ||
    payload.transactionId ||
    payload.id ||
    ""
  );
}
