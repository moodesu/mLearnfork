/** A migration-only BrowserWindow closing is not a request to quit the application. */
export class StartupWindowGuard {
  active = false;

  async during<T>(operation: () => Promise<T>): Promise<T> {
    this.active = true;
    try { return await operation(); }
    finally { this.active = false; }
  }
}
