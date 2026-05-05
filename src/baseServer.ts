import express, { Request, Response, Express } from "express";
import bodyParser from "body-parser";
import process from "process";
import https from "https";
import cors from "cors";
import net from "net";
import fs from "fs";
/* @ts-ignore */
import "dotenv/config";

type methods = "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS";

type RouteHandler = (
  req: Request,
  res: Response
) => void | Promise<void> | Promise<Response<unknown, Record<string, unknown>> | undefined>;

interface Middleware {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
  name?: string;
  handle?: {
    stack?: Middleware[];
  };
}

class Server {
  public app: Express;
  protected server: https.Server;
  protected readonly host: string;
  protected port: number | undefined;
  protected privateKeyPath = process.env.PRIVKEY_PATH || undefined;
  protected certificatePath = process.env.CERT_PATH || undefined;
  protected chainPath = process.env.CHAIN_PATH || undefined;

  private allowedOrigins = new Set<string>([]);
  private allowedMethods = new Set<methods>(["GET"]);
  private publicCorsRoutes = new Map<string, Set<methods>>();

  public get baseUrl(): string {
    const host = this.host;
    const port = this.port;

    return `https://${host}:${port}`;
  }

  public addAllowedOrigins(origin: string | string[]): void {
    if (Array.isArray(origin)) {
      origin.forEach((item) => this.allowedOrigins.add(item));
      return;
    }

    this.allowedOrigins.add(origin);
  }

  public constructor(host: string, port?: number, allowedOrigins?: string | string[]) {
    this.host = host;

    if (allowedOrigins) {
      this.addAllowedOrigins(allowedOrigins);
    }

    if (!this.privateKeyPath || !this.certificatePath || !this.chainPath) {
      console.warn("Warning: SSL certificate paths are not fully set in environment variables. Aborting.");
      process.exit(1);
    }

    const sslOptions = {
      key: fs.readFileSync(this.privateKeyPath, "utf8"),
      cert: fs.readFileSync(this.certificatePath, "utf8"),
      ca: fs.readFileSync(this.chainPath, "utf8"),
      minVersion: "TLSv1.2" as const
    };

    this.app = express();
    this.app.use(bodyParser.json());
    this.server = https.createServer(sslOptions, this.app);
    this.port = port;

    this.app.use((req, res, next) => {
      if (this.isPublicCorsRequest(req)) {
        cors({
          origin: "*",
          methods: this.getPublicCorsMethods(req.path)
        })(req, res, next);

        return;
      }

      cors({
        origin: (origin, callback) => {
          if (!origin || this.allowedOrigins.has(origin)) {
            callback(null, true);
            return;
          }

          callback(new Error("Not allowed by CORS"));
        },
        methods: Array.from(this.allowedMethods)
      })(req, res, next);
    });
  }

  public registerRoute(path: string, method: methods, handler: string | RouteHandler): void {
    if (typeof handler === "string") {
      this.app.use(path, express.static(handler));
      return;
    }

    this.app[method.toLowerCase() as keyof Express](path, handler);
  }

  public addCorsOrigin(origin: string, method: methods): void {
    this.allowedOrigins.add(origin);
    this.allowedMethods.add(method);
  }

  public addPubCorsRte(routePath: string, method: methods | methods[]): void {
    const methodsToAdd = Array.isArray(method) ? method : [method];
    const existing = this.publicCorsRoutes.get(routePath) ?? new Set<methods>();

    for (const item of methodsToAdd) {
      existing.add(item);
    }

    this.publicCorsRoutes.set(routePath, existing);
  }

  public async start(): Promise<void> {
    this.port = !this.port ? await this.findFreePort() : this.port;
    this.server.listen(this.port);
  }

  protected async findFreePort(startPort = 3000, endPort = 4000): Promise<number> {
    for (let port = startPort; port <= endPort; port++) {
      if (await this.isPortFree(port)) return port;
    }

    throw new Error("No free ports available");
  }

  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close();
        resolve(true);
      });

      server.listen(port);
    });
  }

  private isPublicCorsRequest(req: Request): boolean {
    const requestedMethod = this.readRequestedCorsMethod(req);

    if (!requestedMethod) {
      return false;
    }

    for (const [routePath, routeMethods] of this.publicCorsRoutes) {
      if (!routeMethods.has(requestedMethod)) {
        continue;
      }

      if (this.routeMatches(routePath, req.path)) {
        return true;
      }
    }

    return false;
  }

  private getPublicCorsMethods(requestPath: string): methods[] {
    const methodsForPath = new Set<methods>();

    for (const [routePath, routeMethods] of this.publicCorsRoutes) {
      if (!this.routeMatches(routePath, requestPath)) {
        continue;
      }

      for (const method of routeMethods) {
        methodsForPath.add(method);
      }
    }

    return Array.from(methodsForPath);
  }

  private readRequestedCorsMethod(req: Request): methods | undefined {
    const requestMethod = req.method.toUpperCase();
    const candidate = requestMethod === "OPTIONS"
      ? req.header("access-control-request-method")?.toUpperCase()
      : requestMethod;

    return this.isKnownMethod(candidate) ? candidate : undefined;
  }

  private isKnownMethod(value: string | undefined): value is methods {
    return value === "GET"
      || value === "POST"
      || value === "PUT"
      || value === "DELETE"
      || value === "OPTIONS";
  }

  private routeMatches(routePath: string, requestPath: string): boolean {
    if (!routePath.endsWith("*")) {
      return routePath === requestPath;
    }

    const prefix = routePath.slice(0, -1);

    return requestPath.startsWith(prefix) && requestPath.length > prefix.length;
  }

  public logEndpoints(): void {
    const appWithRouter = this.app as Express & {
      _router?: {
        stack?: Middleware[];
      };
    };
    const router = appWithRouter._router;

    if (!router || !Array.isArray(router.stack)) {
      console.warn("⚠️ Express router not initialised yet");
      return;
    }

    router.stack.forEach((middleware: Middleware) => {
      if (middleware.route) {
        console.log(
          `Endpoint: https://${this.host}:${this.port}${middleware.route.path}, Method: ${Object.keys(middleware.route.methods).join(", ").toUpperCase()}`
        );
        return;
      }

      if (middleware.name !== "router" || !middleware.handle || !Array.isArray(middleware.handle.stack)) {
        return;
      }

      middleware.handle.stack.forEach((handler: Middleware) => {
        if (!handler.route) {
          return;
        }

        console.log(
          `Endpoint: https://${this.host}:${this.port}${handler.route.path}, Method: ${Object.keys(handler.route.methods).join(", ").toUpperCase()}`
        );
      });
    });
  }

  public getPort(): number | undefined {
    return this.port;
  }

  public getHost(): string {
    return this.host;
  }

  public get allowedOriginsList(): string[] {
    return Array.from(this.allowedOrigins);
  }
}

export default Server;