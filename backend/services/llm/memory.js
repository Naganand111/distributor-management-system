/**
 * Bounded, in-memory conversation context for the LLM layer.
 *
 * Nothing here is persisted and nothing is read back from the database. Only a
 * few recent, normalised questions are retained per conversation, purely so the
 * shadow model can see "how much was it?" in context. The content is untrusted
 * data: it is fenced and defused before it ever reaches a provider.
 */

const MAX_CONVERSATIONS = 50;
const MAX_TURNS = 2;
const MAX_TURN_CHARS = 500;

const conversations = new Map();

function normaliseId(conversationId) {
  if (conversationId === null || conversationId === undefined) return null;
  const id = String(conversationId);
  return id.trim() ? id : null;
}

/** Record the caller's latest question for later turns. */
export function rememberTurn(conversationId, message) {
  const id = normaliseId(conversationId);
  if (!id || typeof message !== "string") return;

  const text = message.replace(/\s+/g, " ").trim().slice(0, MAX_TURN_CHARS);
  if (!text) return;

  const turns = conversations.get(id) || [];
  turns.push(text);
  while (turns.length > MAX_TURNS) turns.shift();

  /* Insertion-ordered map: re-inserting moves the entry to the end, which
     makes eviction below a plain oldest-first policy. */
  conversations.delete(id);
  conversations.set(id, turns);

  while (conversations.size > MAX_CONVERSATIONS) {
    const oldest = conversations.keys().next().value;
    conversations.delete(oldest);
  }
}

/** Most recent questions, oldest first. Returns a copy. */
export function recentTurns(conversationId) {
  const id = normaliseId(conversationId);
  if (!id) return [];
  return [...(conversations.get(id) || [])];
}

export function clearLlmMemory() {
  conversations.clear();
}

/** Test/diagnostic counters. Contains no conversation text. */
export function llmMemoryStats() {
  let turns = 0;
  for (const entries of conversations.values()) turns += entries.length;
  return { conversations: conversations.size, turns };
}