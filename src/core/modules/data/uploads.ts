import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../../errors';

/** Uploaded backup files wait here until they are restored (or for an hour at most). */
const MAX_AGE_MS = 60 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

function uploadsDir(dataDir: string): string {
  return path.join(dataDir, 'uploads');
}

function fileFor(dataDir: string, businessId: string, uploadId: string): string {
  return path.join(uploadsDir(dataDir), `${businessId}__${uploadId}.bfbackup`);
}

function removeOldUploads(dir: string): void {
  const limit = Date.now() - MAX_AGE_MS;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < limit) fs.rmSync(file, { force: true });
    } catch {
      /* already gone */
    }
  }
}

/** Keep an uploaded backup file of a business; returns its upload id. */
export function saveUpload(dataDir: string, businessId: string, data: Buffer): string {
  if (!data.length) throw fail.validation('The file is empty.');
  const dir = uploadsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  removeOldUploads(dir);
  const uploadId = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(fileFor(dataDir, businessId, uploadId), data);
  return uploadId;
}

/** The file of an upload made by this business (a business can never reach another's uploads). */
export function uploadedFile(dataDir: string, businessId: string, uploadId: string): string {
  const file = ID_RE.test(uploadId) ? fileFor(dataDir, businessId, uploadId) : '';
  if (!file || !fs.existsSync(file)) throw fail.validation('The uploaded file has expired. Please choose the file again.');
  return file;
}

export function removeUpload(dataDir: string, businessId: string, uploadId: string): void {
  if (ID_RE.test(uploadId)) fs.rmSync(fileFor(dataDir, businessId, uploadId), { force: true });
}
