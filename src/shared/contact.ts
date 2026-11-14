/** Contact details typed by people. */

/** A plausible email address (one @, a dot in the domain, no spaces). */
export function isEmail(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  return v.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(v);
}
