// Thumbnails from Windows (fsThumbnail), loaded only for what is on screen. The Gallery plugin's
// queue, keyed by path and modified time so an edited image gets a fresh one.
//
// A queue rather than a request per tile: scrolling past a thousand tiles mounts and unmounts a
// thousand of them, and only the ones still mounted should cost anything. Newest requests go
// first. Finished thumbnails are blob URLs in a capped cache; the oldest is revoked when it fills.
// A file on a server has none (fsThumbnail asks Windows' shell, which only sees this PC).
import { useEffect, useState } from "react";
import { fsThumbnail } from "../shim/bridge.js";

const CACHE = 600;
const PARALLEL = 4;

/** key -> blob URL, or "" for a file Windows has no thumbnail for. Insertion order is age. */
const cache = new Map<string, string>();
const waiting = new Map<string, Set<(url: string) => void>>();
const queue: { key: string; path: string; px: number }[] = [];
let running = 0;

function store(key: string, url: string) {
  cache.set(key, url);
  if (cache.size > CACHE) {
    const [oldKey, oldUrl] = cache.entries().next().value!;
    cache.delete(oldKey);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  }
}

function pump() {
  while (running < PARALLEL && queue.length) {
    const job = queue.pop()!; // newest first
    if (!waiting.has(job.key)) continue; // everything that wanted it has gone
    running++;
    fsThumbnail(job.path, job.px)
      .then((bytes: Uint8Array) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" })))
      .catch(() => "")
      .then((url: string) => {
        store(job.key, url);
        waiting.get(job.key)?.forEach((f) => f(url));
        waiting.delete(job.key);
        running--;
        pump();
      });
  }
}

/** The thumbnail's URL once loaded, "" when there is none, undefined while waiting. */
export function useThumb(path: string, mtimeMs: number, px: number, enabled = true): string | undefined {
  const key = `${path}|${mtimeMs}|${px}`;
  const [url, setUrl] = useState<string | undefined>(() => cache.get(key));
  useEffect(() => {
    if (!enabled) { setUrl(""); return; }
    const hit = cache.get(key);
    if (hit !== undefined) { setUrl(hit); return; }
    setUrl(undefined);
    let subs = waiting.get(key);
    if (!subs) { subs = new Set(); waiting.set(key, subs); queue.push({ key, path, px }); }
    const done = (u: string) => setUrl(u);
    subs.add(done);
    pump();
    return () => {
      const s = waiting.get(key);
      s?.delete(done);
      if (s && s.size === 0) waiting.delete(key); // left in the queue, skipped by pump
    };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

/** Release every cached thumbnail: the plugin is being reloaded or switched off. */
export function clearThumbs() {
  for (const url of cache.values()) if (url) URL.revokeObjectURL(url);
  cache.clear();
  waiting.clear();
  queue.length = 0;
}
