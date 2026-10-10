import net from "net";

  export async function findFreePort(isPortFree: (port: number) => Promise<boolean>, startPort = 3000, endPort = 4000): Promise<number> {
    for (let port = startPort; port <= endPort; port++) {
      if (await isPortFree(port)) return port;
    }

    throw new Error("No free ports available");
  }


  export function isPortFree(port: number): Promise<boolean> {
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

