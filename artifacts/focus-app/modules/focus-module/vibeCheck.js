/**
 * vibeCheck.js
 *
 * Analyzes the last ~10 messages from a Supabase table and asks the
 * AI to produce a "Relationship Health" summary.
 *
 * Returns:
 * {
 *   trend: 'Improving' | 'Declining' | 'Stable',
 *   score: number,        // 0–100, higher = healthier
 *   summary: string,      // 1–2 sentence human-readable summary
 *   signals: string[],    // bullet observations (warmth, conflict, reciprocity, ...)
 *   confidence: 'low' | 'medium' | 'high'
 * }
 *
 * Environment variables (one of):
 *   - AI_INTEGRATIONS_OPENAI_BASE_URL + AI_INTEGRATIONS_OPENAI_API_KEY (Replit AI Integrations)
 *   - OPENAI_API_KEY (direct OpenAI account)
 */

const OpenAI = require("openai");

const VALID_TRENDS = new Set(["Improving", "Declining", "Stable"]);
const VALID_CONFIDENCE = new Set(["low", "medium", "high"]);

function buildClient() {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "vibeCheck: missing OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY)."
    );
  }

  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

/**
 * Normalize a Supabase row into the chat-friendly shape we'll send to the model.
 *
 * Accepts rows like:
 *   { id, created_at, sender, content, ... }
 *   { id, timestamp, author, body }
 *   { id, ts, from, text }
 */
function normalizeMessage(row, index) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const sender =
    row.sender ?? row.author ?? row.from ?? row.user ?? row.role ?? "unknown";
  const content =
    row.content ?? row.body ?? row.text ?? row.message ?? "";
  const timestamp =
    row.created_at ?? row.timestamp ?? row.ts ?? row.sent_at ?? null;

  if (!content) return null;

  return {
    index,
    sender: String(sender),
    content: String(content),
    timestamp: timestamp ? String(timestamp) : null,
  };
}

/**
 * Sort messages oldest → newest so the trend reads chronologically.
 */
function sortChronologically(messages) {
  return [...messages].sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : a.index;
    const tb = b.timestamp ? Date.parse(b.timestamp) : b.index;
    return (Number.isNaN(ta) ? a.index : ta) -
           (Number.isNaN(tb) ? b.index : tb);
  });
}

function formatForPrompt(messages) {
  return messages
    .map((m) => {
      const ts = m.timestamp ? ` [${m.timestamp}]` : "";
      return `${m.sender}${ts}: ${m.content}`;
    })
    .join("\n");
}

/**
 * Public API.
 *
 * @param {Array<object>} messages - Up to 10 recent message rows from Supabase.
 * @param {object} [options]
 * @param {string} [options.model="gpt-5.4"] - OpenAI model to use.
 * @param {object} [options.client] - Inject an OpenAI-compatible client (for tests).
 * @returns {Promise<{trend: string, score: number, summary: string, signals: string[], confidence: string}>}
 */
async function vibeCheck(messages, options = {}) {
  if (!Array.isArray(messages)) {
    throw new TypeError("vibeCheck: messages must be an array.");
  }

  const normalized = messages
    .map(normalizeMessage)
    .filter(Boolean);

  if (normalized.length === 0) {
    return {
      trend: "Stable",
      score: 50,
      summary: "Not enough message data to assess relationship health.",
      signals: [],
      confidence: "low",
    };
  }

  const sorted = sortChronologically(normalized).slice(-10);
  const transcript = formatForPrompt(sorted);
  const model = options.model || "gpt-5.4";
  const client = options.client || buildClient();

  const systemPrompt = [
    "You are a relationship analyst.",
    "Given a short chronological transcript of messages between people,",
    "judge the *trend* of the relationship across the conversation.",
    "Compare the EARLIER half to the LATER half — is engagement, warmth,",
    "and reciprocity going up, going down, or holding steady?",
    "",
    "Rules:",
    "- Output ONLY valid JSON matching the requested schema.",
    "- trend must be exactly one of: Improving, Declining, Stable.",
    "- score is an integer 0-100 (higher = healthier).",
    "- summary is 1-2 sentences, plain English.",
    "- signals is an array of 2-5 short bullet observations.",
    "- confidence reflects how much signal the transcript actually gave you.",
  ].join("\n");

  const userPrompt = [
    "Analyze this conversation:",
    "",
    transcript,
    "",
    "Respond with JSON of the form:",
    "{",
    '  "trend": "Improving" | "Declining" | "Stable",',
    '  "score": 0-100,',
    '  "summary": "...",',
    '  "signals": ["...", "..."],',
    '  "confidence": "low" | "medium" | "high"',
    "}",
  ].join("\n");

  const response = await client.chat.completions.create({
    model,
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices?.[0]?.message?.content ?? "{}";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("vibeCheck: model did not return valid JSON.");
  }

  // Coerce + validate
  const trend = VALID_TRENDS.has(parsed.trend) ? parsed.trend : "Stable";
  const confidence = VALID_CONFIDENCE.has(parsed.confidence)
    ? parsed.confidence
    : "low";

  let score = Number(parsed.score);
  if (!Number.isFinite(score)) score = 50;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    trend,
    score,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    signals: Array.isArray(parsed.signals)
      ? parsed.signals.map(String).slice(0, 5)
      : [],
    confidence,
  };
}

module.exports = { vibeCheck };
