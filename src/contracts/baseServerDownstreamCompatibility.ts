import { Server, MutexProtoBuffStore, ProtoBuffObjectCodec, type ProtoBuffCodec } from '@kittycrypto/server';
import OriginalServer from '../baseServer';
import type { Request, Response, Express } from 'express';
import type https from 'https';

/**
 * Compile-only fixtures modelled on Hostel4Pets and the MaeBot/FelineBot consumers.
 * No constructor is executed: server startup requires real TLS certificates.
 */
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type RootClassIsOriginal = Assert<Equal<typeof Server, typeof OriginalServer>>;
type ConstructorSignature = Assert<Equal<ConstructorParameters<typeof Server>,
  [host: string, port?: number, allowedOrigins?: string | string[]]>>;
type StartSignature = Assert<Equal<ReturnType<Server['start']>, Promise<void>>>;
type PortSignature = Assert<Equal<ReturnType<Server['getPort']>, number | undefined>>;
type HostSignature = Assert<Equal<ReturnType<Server['getHost']>, string>>;
type AccessorSignature = Assert<Equal<Server['allowedOriginsList'], string[]>>;
type ExpressAppSignature = Assert<Equal<Server['app'], Express>>;

/** The routes and handler styles actually used by Hostel4Pets. */
export function registerHostel4PetsStyleRoutes(server: Server): void {
  server.registerRoute('/calendar.json', 'GET', async (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });
  server.registerRoute('/booking/price', 'POST', async (_req: Request, res: Response) => {
    return res.status(200).json({ total: 42 });
  });
  server.registerRoute('/chat/send', 'POST', (_req: Request, res: Response) => {
    res.status(202).end();
  });
  server.registerRoute('/webapps/:sessionId/', 'GET', async (req: Request, res: Response) => {
    void req.params;
    res.status(200).end();
  });
  server.registerRoute('/staff-chat', 'GET', '/tmp/static');
  server.registerRoute('/sounds', 'GET', '/tmp/sounds');
  server.registerRoute('/webapp/close', 'POST', (_req: Request, res: Response) => {
    res.status(204).end();
  });
  server.addCorsOrigin('https://example.org', 'POST');
  server.addAllowedOrigins(['https://example.org']);
  server.addPubCorsRte('/chat/*', ['GET', 'OPTIONS']);
  void server.app;
  void server.baseUrl;
  void server.allowedOriginsList;
  void server.getPort();
  void server.getHost();
}

/** Mirrors the downstream entry point, but does not execute it in CI. */
export async function hostel4PetsStyleStartup(
  host: string, port: number, allowedOrigins: string[]
): Promise<void> {
  const server = new Server(host, port, allowedOrigins);
  registerHostel4PetsStyleRoutes(server);
  await server.start();
  server.logEndpoints();
}

/** Keep protected hooks usable by existing subclasses. */
export class DownstreamServerSubclass extends Server {
  public inspect(): void {
    const protectedServer: https.Server = this.server;
    void protectedServer;
    void this.host;
    void this.port;
    void this.privateKeyPath;
    void this.certificatePath;
    void this.chainPath;
    void this.findFreePort(3000, 4000);
  }
}

/** Keep names/types used in MaeBot, FelineBot and Mae Tickets. */
export function makeStorageConsumer<T>(
  filePath: string,
  codec: ProtoBuffCodec<T>,
  initialValue: () => T
): MutexProtoBuffStore<T> {
  return new MutexProtoBuffStore<T>({
    filePath, codec, initialValue,
    lockRetryDelayMs: 25,
    lockTimeoutMs: 5000,
    corruptionPolicy: 'throw',
    onCorrupt: ({ filePath, raw, backupPath }) => {
      void filePath;
      void raw;
      void backupPath;
    }
  });
}

export type DownstreamTypeContract =
  RootClassIsOriginal | ConstructorSignature | StartSignature |
  PortSignature | HostSignature | AccessorSignature | ExpressAppSignature;
