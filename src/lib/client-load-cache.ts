export type LoadSnapshot<T = unknown> = {
  data: T | null;
  error: string;
  loading: boolean;
};

export const pendingLoad: LoadSnapshot = {
  data: null,
  error: "",
  loading: true,
};
export const disabledLoad: LoadSnapshot = {
  data: null,
  error: "",
  loading: false,
};

type Entry = {
  snapshot: LoadSnapshot;
  updatedAt: number;
  controller?: AbortController;
  promise?: Promise<void>;
};

/** In-memory cache owned by one app session, never shared across server requests. */
export class ClientLoadCache {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();
  constructor(
    private maxAge = 120_000,
    private maxEntries = 80,
  ) {}

  read<T>(key: string | null): LoadSnapshot<T> {
    if (!key) return disabledLoad as LoadSnapshot<T>;
    const entry = this.entries.get(key);
    if (
      !entry ||
      (!entry.promise && Date.now() - entry.updatedAt > this.maxAge)
    )
      return pendingLoad as LoadSnapshot<T>;
    return entry.snapshot as LoadSnapshot<T>;
  }

  subscribe(key: string | null, listener: () => void) {
    if (!key) return () => {};
    const listeners = this.listeners.get(key) || new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }

  private emit(key: string) {
    this.listeners.get(key)?.forEach((listener) => listener());
  }

  set<T>(key: string, data: T | null) {
    this.entries.get(key)?.controller?.abort();
    this.entries.set(key, {
      snapshot: { data, error: "", loading: false },
      updatedAt: Date.now(),
    });
    this.emit(key);
    this.prune();
  }

  load<T>(
    key: string,
    fetcher: (signal: AbortSignal) => Promise<T>,
    force = false,
  ) {
    const previous = this.entries.get(key);
    if (previous?.promise && !force) return previous.promise;
    const snapshot = this.read<T>(key);
    previous?.controller?.abort();
    const controller = new AbortController();
    const entry: Entry = {
      snapshot: { data: snapshot.data, error: "", loading: true },
      updatedAt: Date.now(),
      controller,
    };
    this.entries.set(key, entry);
    const current = () =>
      this.entries.get(key) === entry && !controller.signal.aborted;
    entry.promise = Promise.resolve()
      .then(() => fetcher(controller.signal))
      .then((data) => {
        if (current()) entry.snapshot = { data, error: "", loading: false };
      })
      .catch((error: Error) => {
        if (current())
          entry.snapshot = {
            data: entry.snapshot.data,
            error: error.message,
            loading: false,
          };
      })
      .finally(() => {
        if (!current()) return;
        entry.updatedAt = Date.now();
        entry.promise = undefined;
        entry.controller = undefined;
        this.emit(key);
        this.prune();
      });
    this.emit(key);
    return entry.promise;
  }

  clear() {
    this.entries.forEach((entry) => entry.controller?.abort());
    this.entries.clear();
    this.listeners.forEach((_, key) => this.emit(key));
  }

  private prune() {
    if (this.entries.size <= this.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (!entry.promise && !this.listeners.has(key)) this.entries.delete(key);
      if (this.entries.size <= this.maxEntries) break;
    }
  }
}
