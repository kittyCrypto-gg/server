import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Server, MutexProtoBuffStore, ProtoBuffObjectCodec } from '@kittycrypto/server';
import BaseServer from '../src/baseServer';
import * as root from '../src/index';

const gitBlobHash = (source: Buffer): string => createHash('sha1')
  .update(Buffer.from('blob ' + source.length + '\0'))
  .update(source)
  .digest('hex');

describe('downstream Server contract', () => {
  test('keeps the exact HTTP server and package-entry source from the pre-refactor baseline', () => {
    const serverFile = readFileSync(path.resolve(import.meta.dir, '../src/baseServer.ts'));
    const entryFile = readFileSync(path.resolve(import.meta.dir, '../src/index.ts'));
    expect(gitBlobHash(serverFile)).toBe('e30f05bb29fefd3d32cedf94e69d9e069f7495c2');
    expect(gitBlobHash(entryFile)).toBe('e14333f177c935f8226f49487e1a45ed7f932b39');
  });
  test('retains the original Server class identity and required prototype methods', () => {
    expect(Server).toBe(BaseServer);
    for (const member of [
      'constructor','registerRoute','addAllowedOrigins','addCorsOrigin',
      'addPubCorsRte','start','logEndpoints','getPort','getHost','findFreePort'
    ]) {
      expect(typeof Object.getOwnPropertyDescriptor(Server.prototype, member)?.value).toBe('function');
    }
    expect(typeof Object.getOwnPropertyDescriptor(Server.prototype, 'baseUrl')?.get).toBe('function');
    expect(typeof Object.getOwnPropertyDescriptor(Server.prototype, 'allowedOriginsList')?.get).toBe('function');
  });
  test('preserves the whole historical package-root runtime namespace', () => {
    expect(Object.keys(root).sort()).toEqual(['MutexProtoBuffStore','ProtoBuffObjectCodec','Server']);
    expect(root.Server).toBe(Server);
    expect(root.MutexProtoBuffStore).toBe(MutexProtoBuffStore);
    expect(root.ProtoBuffObjectCodec).toBe(ProtoBuffObjectCodec);
  });
});
