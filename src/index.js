import { createBot } from "./bot.js";
import { startTochkaWebhookServer } from "./tochkaWebhook.js";

const bot = createBot();

bot.launch().then(() => {
  console.log("Finance bot is running");
  startTochkaWebhookServer(bot);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
