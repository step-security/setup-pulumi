import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findChecksum, verifyChecksum } from '../verify-checksum';

jest.mock('axios');
const mockedGet = axios.get as jest.Mock;
(axios.isAxiosError as unknown as jest.Mock) = jest.fn(
  (e: any) => !!e && e.isAxiosError === true,
);

const URL_ = 'https://get.pulumi.com/releases/sdk/pulumi-v3.0.0-linux-x64.tar.gz';
const SUMS = 'https://get.pulumi.com/releases/sdk/pulumi-3.0.0-checksums.txt';
const content = 'pulumi-archive-bytes';
const good = crypto.createHash('sha256').update(content).digest('hex');
const other = 'a'.repeat(64);

let file: string;
beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vc-')), 'pulumi.tar.gz');
  fs.writeFileSync(file, content);
  mockedGet.mockReset();
});

const sums = (hash: string) =>
  `${other}  pulumi-v3.0.0-darwin-x64.tar.gz\n${hash}  pulumi-v3.0.0-linux-x64.tar.gz\n`;

describe('findChecksum', () => {
  it('finds the hash for an exact filename', () => {
    expect(findChecksum(sums(good), 'pulumi-v3.0.0-linux-x64.tar.gz')).toBe(good);
  });
  it('returns undefined when the file is absent', () => {
    expect(findChecksum(sums(good), 'nope.tar.gz')).toBeUndefined();
  });
});

describe('verifyChecksum', () => {
  it('verifies a matching checksum', async () => {
    mockedGet.mockResolvedValue({ data: sums(good) });
    await expect(verifyChecksum(file, URL_, SUMS)).resolves.toBe('verified');
  });

  it('throws on mismatch', async () => {
    mockedGet.mockResolvedValue({ data: sums(other) });
    await expect(verifyChecksum(file, URL_, SUMS)).rejects.toThrow('Checksum mismatch');
  });

  it('throws when the archive has no entry in the checksum file', async () => {
    mockedGet.mockResolvedValue({ data: `${other}  something-else.tar.gz\n` });
    await expect(verifyChecksum(file, URL_, SUMS)).rejects.toThrow('No checksum found');
  });

  it.each([403, 404])('skips when checksum file is unpublished (%i)', async (status) => {
    mockedGet.mockRejectedValue({ isAxiosError: true, response: { status } });
    await expect(verifyChecksum(file, URL_, SUMS)).resolves.toBe('skipped');
  });

  it('fails on other fetch errors', async () => {
    mockedGet.mockRejectedValue({ isAxiosError: true, response: { status: 500 } });
    await expect(verifyChecksum(file, URL_, SUMS)).rejects.toThrow('Failed to fetch checksums');
  });
});
