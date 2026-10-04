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
 * Roboty, které stahují jen náhled sdíleného odkazu (titulek, popis, obrázek) pro WhatsApp, Messenger, X,
 * Slack, Telegram, Discord a LinkedIn. Na webech párů smí číst, aby náhled fungoval; web dál nikdo neindexuje
 * (`X-Robots-Tag: noindex` a meta robots). iMessage stahuje náhled z telefonu odesílatele, robots.txt nečte.
 */
export const LINK_PREVIEW_BOTS = [
  "facebookexternalhit",
  "Facebot",
  "WhatsApp",
  "Twitterbot",
  "Slackbot-LinkExpanding",
  "TelegramBot",
  "Discordbot",
  "LinkedInBot",
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
