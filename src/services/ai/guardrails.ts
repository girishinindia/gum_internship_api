/**
 * AI guardrails (R2): keep user input bounded, strip PII before it reaches a
 * model, and neutralise obvious prompt-injection attempts. These are
 * defence-in-depth — the system prompt also instructs the model to ignore
 * embedded instructions and answer only from provided context.
 */

const MAX_INPUT_CHARS = 4000;

// PII patterns redacted before any model call (logged usage is also PII-free).
const PII_PATTERNS: { re: RegExp; tag: string }[] = [
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, tag: '[email]' },
  { re: /\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/g, tag: '[phone]' },           // Indian mobile
  { re: /\b[A-Z]{5}\d{4}[A-Z]\b/g, tag: '[pan]' },                     // PAN
  { re: /\b\d{4}\s?\d{4}\s?\d{4}\b/g, tag: '[aadhaar]' },              // Aadhaar-like
  { re: /\b(?:\d[ -]?){13,16}\b/g, tag: '[card]' },                    // card-like
];

// Lines that look like attempts to override the system prompt.
const INJECTION_RE =
  /(ignore (all |any |the )?(previous|above|prior) (instructions|prompts?))|(\bsystem prompt\b)|(\bdisregard\b.*\binstructions\b)|(\byou are now\b)|(\bact as\b.*\b(developer|admin|root)\b)/gi;

export function stripPii(text: string): string {
  let out = text;
  for (const { re, tag } of PII_PATTERNS) out = out.replace(re, tag);
  return out;
}

export interface SanitizeResult {
  text: string;
  flagged: boolean; // injection-like content was neutralised
}

/** Clamp length, strip PII, and defang injection markers. */
export function sanitizeUserInput(raw: string): SanitizeResult {
  const clipped = (raw ?? '').slice(0, MAX_INPUT_CHARS);
  const flagged = INJECTION_RE.test(clipped);
  INJECTION_RE.lastIndex = 0;
  const defanged = clipped.replace(INJECTION_RE, '[removed]');
  return { text: stripPii(defanged), flagged };
}

export { MAX_INPUT_CHARS };
