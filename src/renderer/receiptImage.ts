/**
 * A picture of a receipt (for sending a bill on WhatsApp). The receipt HTML is
 * self-contained (inline styles, the logo and QR code inside it), so it is laid
 * out in a hidden frame, drawn through an SVG <foreignObject> onto a canvas and
 * saved as JPG (to send) and PNG (for the clipboard, which takes only PNG).
 */

const CSS_PX_PER_MM = 96 / 25.4;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The bill could not be drawn as a picture.'));
    img.src = src;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture of the bill could not be made.'))), type, quality),
  );
}

/** The receipt laid out at its paper width in a hidden frame: its markup (as XHTML) and size in CSS pixels. */
async function layOut(html: string, paperWidthMm: number): Promise<{ xhtml: string; width: number; height: number }> {
  const width = Math.round(paperWidthMm * CSS_PX_PER_MM);
  const frame = document.createElement('iframe');
  // No scripts run inside; same-origin lets this page measure it.
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:200px;border:0;visibility:hidden;`;
  const loaded = new Promise<void>((resolve) => (frame.onload = () => resolve()));
  frame.srcdoc = html;
  document.body.appendChild(frame);
  try {
    await loaded;
    const doc = frame.contentDocument;
    if (!doc) throw new Error('The bill could not be laid out.');
    await doc.fonts?.ready;
    const height = Math.ceil(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0));
    return { xhtml: new XMLSerializer().serializeToString(doc.documentElement), width, height };
  } finally {
    frame.remove();
  }
}

/**
 * JPG and PNG pictures of a receipt, `scale` times its size on screen (3 = sharp on phones).
 * Throws when this browser cannot draw it (e.g. some versions of Safari).
 */
export async function receiptPictures(html: string, paperWidthMm: number, scale = 3): Promise<{ jpg: Blob; png: Blob }> {
  const { xhtml, width, height } = await layOut(html, paperWidthMm);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('The picture of the bill could not be made.');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  const [jpg, png] = await Promise.all([canvasBlob(canvas, 'image/jpeg', 0.92), canvasBlob(canvas, 'image/png')]);
  return { jpg, png };
}

/** Put a picture on the clipboard, ready to paste (Ctrl+V) in a WhatsApp chat. False when not allowed here. */
export async function copyPicture(png: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}
