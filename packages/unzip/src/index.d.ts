declare module "cubelaunch-zip" {
  import { Entry, ZipFileOptions, ZipFile, Options } from 'yauzl';
  import { Readable } from 'stream';

  function open(target: string | Buffer | number, options?: Options): Promise<ZipFile>;
  function openEntryReadStream(zip: ZipFile, entry: Entry, options?: ZipFileOptions): Promise<Readable>;
  function readEntry(zip: ZipFile, entry: Entry, options?: ZipFileOptions): Promise<Buffer>;
  function getEntriesRecord(entries: Entry[]): Record<string, Entry>;
  function filterEntries(zip: ZipFile, entries: Array<string | ((entry: Entry) => boolean)>): Promise<(Entry | undefined)[]>;
  function walkEntries(zip: ZipFile, entryHandler: (entry: Entry) => Promise<boolean> | boolean | void): Promise<void>;
  function readAllEntries(zipFile: ZipFile): Promise<Entry[]>;
  function walkEntriesGenerator(zip: ZipFile): AsyncGenerator<Entry, void, boolean | undefined>;
}