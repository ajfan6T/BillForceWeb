/**
 * Sending a bill on WhatsApp: the customer's number as WhatsApp wants it and the
 * wa.me link that opens a chat with them.
 */

/**
 * The WhatsApp number (country code + number, digits only, e.g. "919820011111") for a phone
 * as typed, or null when it cannot be one. A number without a country code is taken as an
 * Indian mobile number: "98200 11111", "098200 11111" and "+91 98200 11111" all give
 * 919820011111. Numbers of other countries need the "+" and the country code.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim();
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  const international = raw.startsWith('+') || d.startsWith('00');
  if (d.startsWith('00')) d = d.slice(2);
  if (international) {
    if (d.startsWith('91')) return /^91[6-9]\d{9}$/.test(d) ? d : null;
    return /^[1-9]\d{7,14}$/.test(d) ? d : null;
  }
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) return /^[6-9]/.test(d) ? `91${d}` : null;
  if (d.length === 12 && d.startsWith('91')) return /^91[6-9]/.test(d) ? d : null;
  return null;
}

/** What is wrong with a number typed for WhatsApp (null when it can be used). */
export function whatsappNumberProblem(phone: string | null | undefined): string | null {
  if (!(phone ?? '').trim()) return "Enter the customer's WhatsApp number";
  return whatsappNumber(phone) ? null : 'Enter a 10-digit mobile number, or + and the country code for a number outside India';
}

/** "+91 98200 11111" for an Indian number, "+971501234567" for others. */
export function formatWhatsappNumber(number: string): string {
  const m = /^91(\d{5})(\d{5})$/.exec(number);
  return m ? `+91 ${m[1]} ${m[2]}` : `+${number}`;
}

/** Link that opens a WhatsApp chat with this number, with the message typed in. */
export function whatsappLink(number: string, message: string): string {
  return `https://wa.me/${number}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}
