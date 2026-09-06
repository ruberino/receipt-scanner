/**
 * Unicode NFKC, upper-case, every character that is not a Unicode letter or digit becomes a space,
 * whitespace collapsed, trimmed (architecture.md section 6). Used for product/alias identity and,
 * from T08, the receipt duplicate check.
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
