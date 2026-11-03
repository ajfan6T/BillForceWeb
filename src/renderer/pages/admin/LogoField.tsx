import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui';
import { LOGO_MAX_CHARS, LOGO_MAX_HEIGHT_PX, LOGO_MAX_WIDTH_PX, isLogoDataUrl } from '../../../shared/settings';
import { BoxField } from './common';

/** Image files a logo can be chosen from (it is saved as PNG, or JPG for photos). */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml';
const MAX_FILE_MB = 15;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This file could not be opened as an image. Choose a PNG or JPG file.'));
    img.src = url;
  });
}

/**
 * Turn the chosen image file into a small logo for receipts: scaled down to fit
 * LOGO_MAX_WIDTH_PX x LOGO_MAX_HEIGHT_PX and saved as PNG (keeps a transparent
 * background); a photo that is still too large is saved as JPG on white.
 */
export async function prepareLogo(file: File): Promise<string> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('Choose an image file (PNG or JPG) for the logo.');
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`This image is larger than ${MAX_FILE_MB} MB. Choose a smaller file.`);
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error('This image has no size and cannot be used. Save it as PNG or JPG and choose it again.');
    const scale = Math.min(1, LOGO_MAX_WIDTH_PX / w0, LOGO_MAX_HEIGHT_PX / h0);
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('This computer could not prepare the image.');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    let data = canvas.toDataURL('image/png');
    if (data.length > LOGO_MAX_CHARS) {
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      data = canvas.toDataURL('image/jpeg', 0.85);
    }
    if (!isLogoDataUrl(data)) throw new Error('This image is too detailed to use as a logo. Choose a simpler or smaller image.');
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Business logo in Settings > Business: shows the logo, choose / change / remove it. */
export function LogoField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const choose = async (file: File) => {
    setBusy(true);
    setProblem(null);
    try {
      onChange(await prepareLogo(file));
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  const shown = error ?? problem;
  return (
    <BoxField label="Logo" hint={shown ? undefined : 'Printed at the top of bills and receipts. PNG or JPG; a logo on a white or clear background prints best.'}>
      <div className="logo-field">
        <div className={`logo-box${value ? '' : ' empty'}`}>{value ? <img src={value} alt="Business logo" /> : <span className="muted small">No logo</span>}</div>
        <div className="row">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void choose(file);
            }}
          />
          <Button size="sm" icon={<ImagePlus size={15} />} loading={busy} onClick={() => inputRef.current?.click()}>
            {value ? 'Change logo…' : 'Add logo…'}
          </Button>
          {value && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={15} />}
              onClick={() => {
                setProblem(null);
                onChange('');
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      {shown && <span className="field-error">{shown}</span>}
    </BoxField>
  );
}
