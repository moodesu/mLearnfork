import { createServer } from 'node:net';

export const CUSTOM_APP_NAME = 'Sora 空';
export const CUSTOM_PROFILE_DIRECTORY = 'mlearn-custom';

/** Never kill or attach to the stable app's backend during a custom-build trial. */
export function assertPortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is in use. Close mLearn and its backend before starting Sora 空.`)));
    server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()));
  });
}
