import RssServer from "../rssServer";
import type Server from "../baseServer";
const constructorShape: (host: string, port?: number, origins?: string | string[]) => Server =
    (host, port, origins) => new RssServer(host, port, origins);
void constructorShape;
