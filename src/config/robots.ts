/**
 * Seznam robotů pro `robots.txt` marketingového hostitele. Mění se, proto je v konfiguraci.
 * Před vydáním ověřit v dokumentaci jednotlivých robotů [OVĚŘIT].
 */

/** Vyhledávací a odpovědní roboty: smí číst úvodní stránku. */
export const ALLOWED_BOTS = [
  "Googlebot",
  "Bingbot",
  "DuckDuckBot",
  "Seznambot",
  "Applebot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
] as const;

/**
 * Roboty pro trénování modelů: výslovně zakázané (výchozí hodnota zadání).
 * `ClaudeBot` je podle dokumentace Anthropic trénovací robot, proto je tady a ne mezi povolenými.
 */
export const TRAINING_BOTS = [
  "GPTBot",
  "Google-Extended",
  "ClaudeBot",
  "CCBot",
  "Applebot-Extended",
  "Bytespider",
] as const;
