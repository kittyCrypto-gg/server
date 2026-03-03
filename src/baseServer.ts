import https from "https";
import fs from "fs";
import express, { Request, Response, Express } from "express";
import bodyParser from "body-parser";
import net from "net";
import cors from "cors";
import process from "process";
/* @ts-ignore */
import "dotenv/config"

type methods = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS';

class Server {
  public app: Express;
  protected server: https.Server;
  protected readonly host: string;
  protected port: number | undefined;
  protected privateKeyPath = process.env.PRIVKEY_PATH || undefined;
  protected certificatePath = process.env.CERT_PATH || undefined;
  protected chainPath = process.env.CHAIN_PATH || undefined;

  private allowedOrigins = new Set<string>([
    "http://localhost"
  ]);

  private allowedMethods = new Set<methods>(["GET"]);

  public get baseUrl(): string {
    const host = this.host;
    const port = this.port;
    return `https://${host}:${port}`;
  }

  public addAllowedOrigins(origin: string | string[]): void {
    if (Array.isArray(origin)) {
      origin.forEach(o => this.allowedOrigins.add(o));
    } else {
      this.allowedOrigins.add(origin);
    }
  }

  constructor(host: string, port?: number, allowedOrigins?: string | string[]) {
    this.host = host;

    allowedOrigins ? this.addAllowedOrigins(allowedOrigins) : null;

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

    // single CORS middleware that checks against allowedOrigins/methods
    this.app.use(cors({
      origin: (origin, callback) => {
        if (!origin || this.allowedOrigins.has(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      methods: Array.from(this.allowedMethods),
    }));
  }

  registerRoute(path: string, method: methods, handler: string | ((req: Request, res: Response) => void | Promise<void> | Promise<Response<any, Record<string, any>> | undefined>)): void {
    if (typeof handler === "string") {
      this.app.use(path, express.static(handler));
      return;
    }

    this.app[method.toLowerCase() as keyof Express](path, handler);
  }

  addCorsOrigin(origin: string, method: methods): void {
    this.allowedOrigins.add(origin);
    this.allowedMethods.add(method);
  }

  async start(): Promise<void> {
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

  public logEndpoints() {
    const router = (this.app as any)._router;

    if (!router || !Array.isArray(router.stack)) {
      console.warn("⚠️ Express router not initialised yet");
      return;
    }

    interface Middleware {
      route?: {
        path: string;
        methods: { [method: string]: boolean };
      };
      name?: string;
      handle?: {
        stack?: Middleware[];
      };
    }

    router.stack.forEach((middleware: Middleware) => {
      if (middleware.route) {
        console.log(
          `Endpoint: https://${this.host}:${this.port}${middleware.route.path}, Method: ${Object.keys(middleware.route.methods).join(", ").toUpperCase()}`
        );
      } else if (middleware.name === "router" && Array.isArray(middleware.handle?.stack)) {
        middleware.handle.stack.forEach((handler: Middleware) => {
          if (handler.route) {
            console.log(
              `Endpoint: https://${this.host}:${this.port}${handler.route.path}, Method: ${Object.keys(handler.route.methods).join(", ").toUpperCase()}`
            );
          }
        });
      }
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