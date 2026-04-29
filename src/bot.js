import { Telegraf } from "telegraf";
import { config } from "./config.js";
import {
  analyzeTransactionClarification,
  analyzeTransactionMessage
} from "./aiParser.js";
import { addMemoryNotes } from "./memory.js";
import { appendTransactions, formatDate } from "./sheets.js";
import { sanitizeError } from "./security.js";

const pendingClarifications = new Map();

function buildSuccessMessage(transactions) {
  const total = transactions.reduce((sum, transaction) => sum + transaction.signedAmount, 0);
  const lines = [
    `Сохранено операций: ${transactions.length}`,
    `Итог по сообщению: ${total.toLocaleString("ru-RU")} ₽`,
    ""
  ];

  for (const transaction of transactions) {
    lines.push(
      `${formatDate(transaction.transactionDate)} | ${transaction.signedAmount.toLocaleString("ru-RU")} ₽ | ${transaction.category} | ${transaction.description}`
    );
  }

  return lines.join("\n");
}

export function createBot() {
  const bot = new Telegraf(config.botToken);

  bot.catch(async (error, ctx) => {
    // Никогда не логируем error целиком — Telegraf включает bot.token в URL HTTP запросов
    console.error("Telegraf error:", sanitizeError(error));

    try {
      await ctx.reply(
        [
          "Не получилось обработать сообщение.",
          "Попробуйте еще раз через несколько секунд."
        ].join("\n")
      );
    } catch {
      // Ignore secondary reply failures.
    }
  });

  bot.start((ctx) =>
    ctx.reply(
      [
        "Пришлите операцию в свободной форме.",
        "Примеры:",
        "-3000₽ за amo crm",
        "-100.000₽ себе стоимость",
        "+250000₽ выручка",
        "-15000₽ реклама 02.04",
        "Ровно неделю назад я заплатил менеджеру Игорю 10.000₽",
        "",
        "Можно и пачкой:",
        "Расходы за 1-ое апреля",
        "-3600₽ за 3д дизайн-макет гонщика",
        "-750₽ тильда",
        "-13000₽ СДЭК"
      ].join("\n")
    )
  );

  bot.on("text", async (ctx) => {
    try {
      const chatId = String(ctx.chat?.id || "");
      const pending = pendingClarifications.get(chatId);
      const analysis = pending
        ? await analyzeTransactionClarification({
            originalText: pending.originalText,
            clarificationTurns: pending.clarificationTurns,
            clarificationText: ctx.message.text,
            now: new Date()
          })
        : await analyzeTransactionMessage(ctx.message.text, new Date());

      if (analysis.status === "needs_clarification") {
        pendingClarifications.set(chatId, {
          originalText: pending?.originalText || ctx.message.text,
          clarificationTurns: [
            ...(pending?.clarificationTurns || []),
            ...(pending
              ? [
                  {
                    question: pending.lastQuestion,
                    answer: ctx.message.text
                  }
                ]
              : [])
          ]
        });

        await addMemoryNotes(analysis.memoryNotes || []);
        pendingClarifications.get(chatId).lastQuestion = analysis.question;
        await ctx.reply(analysis.question);
        return;
      }

      pendingClarifications.delete(chatId);
      await addMemoryNotes(analysis.memoryNotes || []);

      await appendTransactions(analysis.transactions, {
        source: "telegram",
        user: ctx.from?.username || `${ctx.from?.first_name || ""} ${ctx.from?.last_name || ""}`.trim(),
        chat: chatId
      });

      await ctx.reply(buildSuccessMessage(analysis.transactions));
    } catch (error) {
      // Логируем санитизированную версию (без токенов в URL)
      console.error("Message processing error:", sanitizeError(error));

      // Пользователю показываем только заранее известные/безопасные сообщения,
      // чтобы исключить любую возможность утечки токенов через error.message
      const humanMessage =
        error.message === "AI_TIMEOUT"
          ? "ИИ-разбор занял слишком много времени. Попробуйте отправить сообщение короче или повторите еще раз."
          : "Что-то пошло не так. Попробуйте еще раз.";

      await ctx.reply(
        [
          "Не смог обработать сообщение через ИИ.",
          humanMessage,
          "",
          "Можно прислать одной строкой или списком из нескольких расходов."
        ].join("\n")
      );
    }
  });

  return bot;
}
