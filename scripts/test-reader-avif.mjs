// Dependency-free regression checks. Run with Node 22.13+ from the project root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const helperSource = await readFile(path.join(root, 'src/shared/utils/readerImageFormats.ts'), 'utf8');
const helper = vm.runInNewContext(`(() => {${stripTypeScriptTypes(helperSource).replaceAll('export function', 'function')}; return { getReaderImageMimeType, isReaderImageFile };})()`);

test('accepts AVIF regardless of extension case or missing browser MIME type', () => {
  for (const name of ['page.avif', 'PAGE.AVIF', 'page.AvIf']) {
    assert.equal(helper.getReaderImageMimeType(name), 'image/avif');
    assert.equal(helper.isReaderImageFile({ name, type: '' }), true);
  }
});

test('preserves existing image formats and rejects non-image extensions', () => {
  for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif']) {
    assert.ok(helper.getReaderImageMimeType(`page.${ext}`));
  }
  for (const name of ['page.avif.txt', 'notes.txt', 'no-extension', 'page.toString', 'page.__proto__']) {
    assert.equal(helper.getReaderImageMimeType(name), undefined);
    assert.equal(helper.isReaderImageFile({ name, type: '' }), false);
  }
  assert.equal(helper.isReaderImageFile({ name: 'image.unknown', type: 'image/custom' }), true);
});

const source = await readFile(path.join(root, 'src/electron/services/fileOperations.ts'), 'utf8');
const stripped = stripTypeScriptTypes(source).replace(/^import .*;\r?\n/gm, '').replaceAll('export function', 'function');

async function withFolder(callback) {
  const home = await mkdtemp(path.join(tmpdir(), 'sora-reader-'));
  try {
    const handlers = new Map();
    const setup = vm.runInNewContext(`(() => {${stripped}; return setupFileOperationsIPC;})()`, {
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      dialog: {}, BrowserWindow: {}, app: { getPath: () => home },
      fs: await import('node:fs/promises'), path,
      getReaderImageMimeType: helper.getReaderImageMimeType,
      IPC_CHANNELS: new Proxy({}, { get: (_, key) => key }),
      getLogger: () => ({ info() {}, warn() {}, error() {} }),
    });
    setup();
    await callback(home, handlers.get('READ_DIRECTORY_IMAGES'));
  } finally { await rm(home, { recursive: true, force: true }); }
}

test('directory IPC includes AVIF, naturally sorts pages, and excludes directories/non-images', async () => {
  await withFolder(async (home, readDirectory) => {
    for (const name of ['page10.avif', 'page2.AVIF', 'page1.png', 'notes.txt']) await writeFile(path.join(home, name), name);
    await mkdir(path.join(home, 'directory.avif'));
    const { files } = await readDirectory(null, home);
    assert.deepEqual(Array.from(files, (file) => file.name), ['page1.png', 'page2.AVIF', 'page10.avif']);
    for (const file of files) assert.equal(Buffer.from(file.data).toString(), file.name);
  });
});

test('an AVIF-only folder can be loaded repeatedly through the saved-folder IPC path', async () => {
  await withFolder(async (home, readDirectory) => {
    await writeFile(path.join(home, '001.avif'), Buffer.from([0, 1, 2, 3]));
    for (let load = 0; load < 2; load++) {
      const { files } = await readDirectory(null, home);
      assert.equal(files.length, 1);
      assert.equal(files[0].data.byteLength, 4);
      assert.equal(helper.getReaderImageMimeType(files[0].name), 'image/avif');
    }
  });
});
