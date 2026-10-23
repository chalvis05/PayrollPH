import { pathToFileURL } from 'node:url';

/** True when the module at `metaUrl` is the script node was started with. */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(entry).href === metaUrl;
}
