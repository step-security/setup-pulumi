import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';

export type VerifyResult = 'verified' | 'skipped';

// Releases older than ~v2.17 have no published checksum file (the host answers
// 403/404). For those we cannot verify, so we warn and skip. Any other failure
// (network error, 5xx, missing entry, mismatch) is fatal.
const UNPUBLISHED_STATUSES = [403, 404];

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// Parses `sha256sum` style output: "<hex>  <filename>" per line.
export function findChecksum(
  checksumFile: string,
  fileName: string,
): string | undefined {
  for (const line of checksumFile.split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match && match[2] === fileName) {
      return match[1].toLowerCase();
    }
  }
  return undefined;
}

export async function verifyChecksum(
  filePath: string,
  downloadUrl: string,
  checksumsUrl: string,
): Promise<VerifyResult> {
  let body: string;
  try {
    const resp = await axios.get<string>(checksumsUrl, {
      responseType: 'text',
      transformResponse: (data) => data,
    });
    body = resp.data;
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response &&
      UNPUBLISHED_STATUSES.includes(error.response.status)
    ) {
      return 'skipped';
    }
    throw new Error(
      `Failed to fetch checksums from ${checksumsUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const fileName = new URL(downloadUrl).pathname.split('/').pop() as string;
  const expected = findChecksum(body, fileName);
  if (!expected) {
    throw new Error(`No checksum found for ${fileName} in ${checksumsUrl}`);
  }

  const actual = await sha256File(filePath);
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${fileName}: expected ${expected}, got ${actual}`,
    );
  }
  return 'verified';
}
