import { createBot } from "./bot.js";

const bot = createBot();

bot.launch().then(() => {
  console.log("Finance bot is running");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
