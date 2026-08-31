import * as vscode from "vscode";
import { OutputChannelLogger } from "../logging/OutputChannelLogger";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Shared plumbing for the on-device content libraries (gifs, videos, news,
 * learning). Each is a versioned `library.json` under
 * `globalStorageUri/<subdir>/`, read once into an in-memory cache, with every
 * write serialized through a promise chain so concurrent read-modify-writes can
 * never clobber each other. The on-disk shape is `{ v: 1, <recordsKey>: T[] }`,
 * kept verbatim per vertical so existing saved files still load.
 *
 * Subclasses add the domain queries and mutations; they read via
 * {@link records}, write via {@link persist}, and serialize multi-step writes
 * with {@link enqueue}.
 */
export abstract class JsonLibrary<TRecord> {
  protected readonly dir: vscode.Uri;
  private readonly indexUri: vscode.Uri;
  private cache: TRecord[] | undefined;
  private chain: Promise<unknown> = Promise.resolve();

  protected constructor(
    globalStorageUri: vscode.Uri,
    subdir: string,
    /** On-disk property that holds the record array, e.g. "gifs". */
    private readonly recordsKey: string,
    private readonly logger: OutputChannelLogger
  ) {
    this.dir = vscode.Uri.joinPath(globalStorageUri, subdir);
    this.indexUri = vscode.Uri.joinPath(this.dir, "library.json");
  }

  /** All records, read from disk once then served from the in-memory cache. */
  protected async records(): Promise<TRecord[]> {
    if (!this.cache) {
      this.cache = await this.read();
    }
    return this.cache;
  }

  /** Persist `records` as the new library contents and update the cache. */
  protected async persist(records: TRecord[]): Promise<void> {
    this.cache = records;
    await vscode.workspace.fs.createDirectory(this.dir);
    const file = { v: 1, [this.recordsKey]: records };
    try {
      await vscode.workspace.fs.writeFile(
        this.indexUri,
        encoder.encode(JSON.stringify(file, null, 2))
      );
    } catch (error) {
      this.logger.error(`Failed to persist ${this.recordsKey} library`, error);
      throw error;
    }
  }

  /** Serialize a read-modify-write so overlapping writes never race. */
  protected enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /** Delete the whole library folder and drop the cache. */
  clearAll(): Promise<void> {
    return this.enqueue(async () => {
      this.cache = undefined;
      try {
        await vscode.workspace.fs.delete(this.dir, { recursive: true, useTrash: false });
      } catch {
        // nothing saved yet
      }
    });
  }

  private async read(): Promise<TRecord[]> {
    try {
      const raw = decoder.decode(await vscode.workspace.fs.readFile(this.indexUri));
      const parsed = JSON.parse(raw) as { v?: unknown } & Record<string, unknown>;
      const arr = parsed[this.recordsKey];
      return parsed.v === 1 && Array.isArray(arr) ? (arr as TRecord[]) : [];
    } catch {
      return [];
    }
  }
}
