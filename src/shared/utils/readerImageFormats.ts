/** Image formats accepted by the reader, independent of browser MIME detection. */
const READER_IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  tiff: 'image/tiff', tif: 'image/tiff', avif: 'image/avif',
};

export function getReaderImageMimeType(fileName: string): string | undefined {
  const extension = /\.([^./\\]+)$/.exec(fileName)?.[1]?.toLowerCase();
  return extension && Object.prototype.hasOwnProperty.call(READER_IMAGE_MIME_TYPES, extension)
    ? READER_IMAGE_MIME_TYPES[extension] : undefined;
}

export function isReaderImageFile(file: { name: string; type?: string }): boolean {
  return !!getReaderImageMimeType(file.name) || !!file.type?.startsWith('image/');
}
