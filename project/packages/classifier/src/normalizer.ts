/**
 * Text normalizer and injection sanitizer for clip text.
 */
export function normalizeText(text: string | null | undefined): string {
  if (!text) return '';

  return (
    text
      // Normalize unicode (handles Devanagari, accents, mixed scripts)
      .normalize('NFKC')
      // Neutralize potential XML/delimiter injection tags
      .replace(/<\/?(clip_content|system|user|assistant|instruction|prompt)[^>]*>/gi, '')
      // Trim excessive whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export function extractHashtags(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/#[\p{L}\p{N}_]+/gu);
  return matches ? matches.map((m) => m.toLowerCase()) : [];
}
