import https from "https";
import fs from "fs";
import express, { Request, Response, Express } from "express";
import bodyParser from "body-parser";
import net from "net";
import cors from "cors";

class Server {
  public app: Express;
  protected server: https.Server;
  protected readonly host: string;
  protected port: number | undefined;

  constructor(host: string, port?: number) {
    this.host = host;

    // Load SSL certificates from the archive directory instead of the symlinked live directory
    const sslOptions = {
      key: fs.readFileSync(`/home/kitty/server/certs/privkey.pem`, "utf8"),
      cert: fs.readFileSync(`/home/kitty/server/certs/cert.pem`, "utf8"),
      ca: fs.readFileSync(`/home/kitty/server/certs/chain.pem`, "utf8"),
    };

    // Initialise Express app
    this.app = express();
    this.app.use(bodyParser.json());

    // Create HTTPS server
    this.server = https.createServer(sslOptions, this.app);

    this.port = port;

    this.app.use(cors({
      origin: 'https://kittycrypto.gg',
      methods: ['GET'],
    }));
  }

  // Method to register routes
  registerRoute(path: string, handler: (req: Request, res: Response) => void): void {
    this.app.post(path, handler);
  }

  // Method to start the server
  async start(): Promise<void> {
    this.port = !this.port ? await this.findFreePort() : this.port;
    this.server.listen(this.port, () => {
      //console.log(`HTTPS server is running on https://${this.host}:${this.port}`);
    });
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
    interface Middleware {
      route?: {
        path: string;
        methods: { [method: string]: boolean };
      };
      name?: string;
      handle?: {
        stack: Middleware[];
      };
    }

    (this.app._router.stack as Middleware[]).forEach((middleware: Middleware) => {
      if (middleware.route) { // Routes registered directly on the app
        console.log(`Endpoint: https://${this.host}:${this.port}${middleware.route.path}, Method: ${Object.keys(middleware.route.methods).join(', ').toUpperCase()}`);
      } else if (middleware.name === 'router') { // Router middleware 
        middleware.handle?.stack.forEach((handler: Middleware) => {
          if (handler.route) {
            console.log(`Endpoint: https://${this.host}:${this.port}${handler.route.path}, Method: ${Object.keys(handler.route.methods).join(', ').toUpperCase()}`);
          }
        });
      }
    });
  }
}

export default Server;
