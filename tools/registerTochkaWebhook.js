#!/usr/bin/env node
/**
 * Регистрация webhook в Точке через API.
 *
 * Использование:
 *   TOCHKA_JWT_TOKEN=... TOCHKA_CUSTOMER_CODE=... \
 *   WEBHOOK_URL=https://your-app.up.railway.app/webhooks/tochka \
 *   node tools/registerTochkaWebhook.js
 *
 * Что делает:
 *  1. POST в /uapi/webhook/v1.0/{customerCode} — создаёт webhook
 *  2. Подписывает на события incomingPayment, incomingSbpPayment,
 *     incomingSbpB2BPayment, acquiringInternetPayment
 *  3. Точка сразу шлёт тестовый webhook на указанный URL —
 *     убедись, что бот уже задеплоен и слушает.
 *
 * JWT нужен с разрешением ManageWebhookData.
 */

import { config } from "../src/config.js";
import { redactSecrets, truncate } from "../src/security.js";

const BASE_URL = "https://enter.tochka.com/uapi";
const EVENT_TYPES = [
  "incomingPayment",
  "incomingSbpPayment",
  "incomingSbpB2BPayment",
  "acquiringInternetPayment"
];

async function main() {
  const url = process.env.WEBHOOK_URL;

  if (!url) {
    console.error("Не задан WEBHOOK_URL (например: https://your-app.up.railway.app/webhooks/tochka)");
    process.exit(1);
  }

  if (!config.tochkaJwtToken) {
    console.error("Не задан TOCHKA_JWT_TOKEN");
    process.exit(1);
  }

  if (!config.tochkaCustomerCode) {
    console.error("Не задан TOCHKA_CUSTOMER_CODE");
    process.exit(1);
  }

  if (!url.startsWith("https://")) {
    console.error("Точка принимает только HTTPS URL на порту 443");
    process.exit(1);
  }

  const endpoint = `${BASE_URL}/webhook/v1.0/${config.tochkaCustomerCode}`;
  const body = {
    webhooksList: EVENT_TYPES,
    url
  };

  console.log(`POST ${endpoint}`);
  console.log("Body:", body);
  console.log("Точка сейчас отправит тестовый webhook на этот URL — он должен вернуть 200.\n");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.tochkaJwtToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  if (!response.ok) {
    console.error(`❌ HTTP ${response.status}`);
    console.error(truncate(redactSecrets(text), 1000));
    process.exit(1);
  }

  console.log("✅ Webhook зарегистрирован");
  console.log(truncate(redactSecrets(text), 1000));
}

main().catch((err) => {
  console.error("Ошибка:", redactSecrets(err.message || String(err)));
  process.exit(1);
});
