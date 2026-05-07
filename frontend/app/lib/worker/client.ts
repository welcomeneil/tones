// Typed Promise wrapper around process.worker.ts. One Worker instance per page
// session; the worker holds the cached grayscale + histogram so re-analyze
// only round-trips the params, not the image.

import type {
  AnalyzeMsg,
  AnalyzeOk,
  ErrorOut,
  InMsg,
  LoadMsg,
  LoadOk,
  OutMsg,
} from "./process.worker";

export class WorkerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

type Pending = {
  resolve: (msg: LoadOk | AnalyzeOk) => void;
  reject: (err: Error) => void;
  detach: () => void;
};

export class ProcessWorkerClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(
      new URL("./process.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = this.onMessage;
  }

  private onMessage = (e: MessageEvent<OutMsg>) => {
    const msg = e.data;
    const handler = this.pending.get(msg.id);
    if (!handler) {
      // Late response after the caller aborted — close any transferred resources.
      if (msg.type === "analyze_ok") msg.zoneMap.close();
      return;
    }
    this.pending.delete(msg.id);
    handler.detach();
    if (msg.type === "error") {
      handler.reject(new WorkerError((msg as ErrorOut).code, (msg as ErrorOut).message));
      return;
    }
    handler.resolve(msg);
  };

  load(blob: Blob, signal: AbortSignal): Promise<LoadOk> {
    const id = this.nextId++;
    const msg: LoadMsg = { type: "load", id, blob };
    return this.send(msg, id, signal) as Promise<LoadOk>;
  }

  analyze(
    params: { algo: "peaks" | "kmeans"; n: number; sigma: number },
    signal: AbortSignal,
  ): Promise<AnalyzeOk> {
    const id = this.nextId++;
    const msg: AnalyzeMsg = { type: "analyze", id, ...params };
    return this.send(msg, id, signal) as Promise<AnalyzeOk>;
  }

  reset() {
    this.worker.postMessage({ type: "reset" } satisfies InMsg);
  }

  terminate() {
    this.worker.terminate();
    for (const [, h] of this.pending) {
      h.detach();
      h.reject(new DOMException("worker terminated", "AbortError"));
    }
    this.pending.clear();
  }

  private send(
    msg: LoadMsg | AnalyzeMsg,
    id: number,
    signal: AbortSignal,
  ): Promise<LoadOk | AnalyzeOk> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      const onAbort = () => {
        const h = this.pending.get(id);
        if (!h) return;
        this.pending.delete(id);
        h.detach();
        h.reject(new DOMException("aborted", "AbortError"));
      };
      const detach = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, { resolve, reject, detach });
      this.worker.postMessage(msg);
    });
  }
}
