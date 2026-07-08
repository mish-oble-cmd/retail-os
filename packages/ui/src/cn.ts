/** Tiny class-name joiner — avoids a clsx dependency for our needs. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
