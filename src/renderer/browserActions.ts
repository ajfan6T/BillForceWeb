/** Printing and downloading from the page itself (used by the API client and the browser edition). */

/** Print HTML (a receipt or report) with the browser's print window, from a hidden frame. */
export function printInBrowser(html: string, copies = 1): void {
  const frame = document.createElement('iframe');
  // No scripts run inside; same-origin lets this page start printing it.
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.onload = () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) return;
    if (copies > 1) doc.body.innerHTML = Array.from({ length: copies }, () => doc.body.innerHTML).join('<div style="break-after: page"></div>');
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

/** Download a file from a link (a one-time server link, or a blob: URL made in the page). */
export function downloadInBrowser(url: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

const MIME: Record<string, string> = {
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  html: 'text/html;charset=utf-8',
};

/** Download data made in the page as a file. */
export function downloadData(fileName: string, data: Uint8Array | string): void {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' }));
  downloadInBrowser(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
