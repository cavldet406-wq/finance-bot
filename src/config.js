import dotenv from "dotenv";

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }

  return value;
}

export const config = {
  botToken: requireEnv("BOT_TOKEN"),
  spreadsheetId: requireEnv("GOOGLE_SHEETS_SPREADSHEET_ID"),
  serviceAccountEmail: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  privateKey: requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5-mini",
  defaultTimezone: process.env.DEFAULT_TIMEZONE || "Europe/Moscow"
};
