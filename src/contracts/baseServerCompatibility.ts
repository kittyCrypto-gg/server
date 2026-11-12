import Server from "../baseServer";
import type { Server as PackageServer } from "../index";

type Assert<T extends true> = T;
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2) ? true : false;
type RootExportIsServer = Assert<Same<typeof Server, typeof PackageServer>>;
type OriginalConstructor = Assert<Same<ConstructorParameters<typeof Server>, [
    host: string,
    port?: number,
    allowedOrigins?: string | string[]
]>>;

class ExistingConsumer extends Server {
    public inspectProtectedMembers(): void {
        void this.server;
        void this.host;
        void this.port;
        void this.privateKeyPath;
        void this.certificatePath;
        void this.chainPath;
        void this.findFreePort();
    }

    public useExistingMethods(): void {
        void this.app;
        void this.baseUrl;
        void this.allowedOriginsList;
        this.addAllowedOrigins(["https://example.org"]);
        this.addCorsOrigin("https://example.org", "GET");
        this.addPubCorsRte("/health", ["GET", "OPTIONS"]);
        this.registerRoute("/health", "GET", (_req, res) => { res.status(200).end(); });
        void this.start();
        this.logEndpoints();
        void this.getPort();
        void this.getHost();
    }
}

export type BaseServerCompatibility = RootExportIsServer | OriginalConstructor | ExistingConsumer;
