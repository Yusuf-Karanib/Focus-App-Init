/**
 * safetyFilters.js
 * Scans a string for PII and sensitive content.
 * Returns an array of detected risk objects.
 */

const PATTERNS = [
  {
    type: "US_PHONE",
    label: "US phone number",
    regex: /(\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
  },
  {
    type: "UAE_PHONE",
    label: "UAE phone number",
    // UAE mobiles: +971 5x xxxx xxxx  |  local: 05x xxxx xxxx
    // UAE landlines: +971 x xxxx xxxx  |  local: 0x xxxx xxxx
    regex: /(\+971|00971|0)[\s.-]?(5[024568]\d{7}|[2-9]\d{7})/g,
  },
  {
    type: "EMAIL",
    label: "Email address",
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  },
  {
    type: "ADDRESS_KEYWORD",
    label: "Address keyword",
    // Common address indicators (case-insensitive, whole-word)
    regex: /\b(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|villa|apartment|apt\.?|flat|building|block|district|sector|zone|community)\b/gi,
  },
  {
    type: "SOCIAL_KEYWORD",
    label: "Social platform reference",
    regex: /\b(snapchat|snap|instagram|facebook|whatsapp|telegram|tiktok)\b/gi,
  },
];

/**
 * Scan `text` for PII and sensitive keywords.
 *
 * @param {string} text - The input string to scan.
 * @returns {{ type: string, label: string, match: string, index: number }[]}
 *   Array of detected risk objects, one entry per match.
 */
function scanForPII(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const risks = [];

  for (const { type, label, regex } of PATTERNS) {
    // Reset lastIndex each time (safety for stateful regexes with /g)
    regex.lastIndex = 0;

    let match;
    while ((match = regex.exec(text)) !== null) {
      risks.push({
        type,
        label,
        match: match[0].trim(),
        index: match.index,
      });
    }
  }

  // Sort results by position in the original string
  risks.sort((a, b) => a.index - b.index);

  return risks;
}

module.exports = { scanForPII };
