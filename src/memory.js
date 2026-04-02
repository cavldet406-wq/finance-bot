import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const MEMORY_FILE = path.join(DATA_DIR, "finance-memory.json");

const EMPTY_MEMORY = {
  notes: []
};

async function ensureMemoryFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(MEMORY_FILE);
  } catch {
    await fs.writeFile(MEMORY_FILE, JSON.stringify(EMPTY_MEMORY, null, 2), "utf8");
  }
}

export async function readMemory() {
  await ensureMemoryFile();

  try {
    const raw = await fs.readFile(MEMORY_FILE, "utf8");
    const parsed = JSON.parse(raw);

    return {
      notes: Array.isArray(parsed.notes) ? parsed.notes : []
    };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}

export async function writeMemory(memory) {
  await ensureMemoryFile();
  await fs.writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2), "utf8");
}

export async function addMemoryNotes(notes) {
  if (!notes.length) {
    return;
  }

  const memory = await readMemory();
  const existing = new Set(memory.notes.map((note) => note.toLowerCase()));

  for (const note of notes) {
    const normalized = String(note || "").trim();

    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();

    if (!existing.has(key)) {
      memory.notes.push(normalized);
      existing.add(key);
    }
  }

  await writeMemory(memory);
}
