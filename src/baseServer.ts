import express from "express";
import type { Request, Express } from "express";
import bodyParser from "body-parser";
import process from "process";
import https from "https";
import cors from "cors";
import fs from "fs";
/* @ts-ignore */
import "dotenv/config";
import type { methods, RouteHandler } from "./baseServer/types";
import * as corsLogic from "./baseServer/cors";
import * as ports from "./baseServer/ports";
import * as logging from "./baseServer/logging";

class Server {
  public app: Express;
  protected server: https.Server;
  protected readonly host: string;
  protected port: number | undefined;
  protected privateKeyPath = process.env["PRIVKEY_PATH"] || undefined;
  protected certificatePath = process.env["CERT_PATH"] || undefined;
  protected chainPath = process.env["CHAIN_PATH"] || undefined;

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
    return await ports.findFreePort(port => this.isPortFree(port), startPort, endPort);
  }

  private isPortFree(port: number): Promise<boolean> {
    return ports.isPortFree(port);
  }

  private corsContext(): corsLogic.CorsContext {
    return {
      publicCorsRoutes: this.publicCorsRoutes,
      readRequestedCorsMethod: req => this.readRequestedCorsMethod(req),
      isKnownMethod: (value): value is methods => this.isKnownMethod(value),
      routeMatches: (routePath, requestPath) => this.routeMatches(routePath, requestPath)
    };
  }

  private isPublicCorsRequest(req: Request): boolean {
    return corsLogic.isPublicCorsRequest(this.corsContext(), req);
  }

  private getPublicCorsMethods(requestPath: string): methods[] {
    return corsLogic.getPublicCorsMethods(this.corsContext(), requestPath);
  }

  private readRequestedCorsMethod(req: Request): methods | undefined {
    return corsLogic.readRequestedCorsMethod(this.corsContext(), req);
  }

  private isKnownMethod(value: string | undefined): value is methods {
    return corsLogic.isKnownMethod(this.corsContext(), value);
  }

  private routeMatches(routePath: string, requestPath: string): boolean {
    return corsLogic.routeMatches(this.corsContext(), routePath, requestPath);
  }

  public logEndpoints(): void {
    logging.logEndpoints(this.app, this.host, this.port);
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