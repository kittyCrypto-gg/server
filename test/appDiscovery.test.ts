import { expect, test } from "bun:test";
import {
    githubRepoToApp,
    mergeDiscoveredApps,
    parseLocalAppsFromNginx,
    type DiscoveredApp
} from "../src/appDiscovery";

const nginx = `
server {
  listen 443 ssl http2;
  server_name app.kittycrow.dev;

  # =========================
  # Mae Discord Activity -> 8893
  # =========================
  location = /mae/activity {
    return 301 /mae/activity/;
  }

  location ^~ /mae/activity/ {
    proxy_pass http://127.0.0.1:8893/;
  }

  # =========================
  # FeLinE Market Tracker -> 8790
  # =========================
  location = /feline {
    return 301 /feline/;
  }

  location /feline/ {
    proxy_pass http://localhost:8790/;
  }

  # =========================
  # Tarot WebApp -> 6667
  # =========================
  location /tarot/ {
    proxy_pass http://[::1]:6667/;
  }

  # =========================
  # Root App Index static assets
  # =========================
  location ^~ /assets/ {
    proxy_pass https://kitty-crow.github.io/app-kittycrow-dev/assets/;
  }

  location / {
    proxy_pass https://kitty-crow.github.io;
  }
}
`;

test("local discovery finds only loopback-backed nginx applications", () => {
    expect(parseLocalAppsFromNginx(nginx)).toEqual([
        {
            name: "Mae Discord Activity",
            href: "/mae/activity/",
            description: "Local service exposed through app.kittycrow.dev/mae/activity/",
            source: "local"
        },
        {
            name: "FeLinE Market Tracker",
            href: "/feline/",
            description: "Local service exposed through app.kittycrow.dev/feline/",
            source: "local"
        },
        {
            name: "Tarot WebApp",
            href: "/tarot/",
            description: "Local service exposed through app.kittycrow.dev/tarot/",
            source: "local"
        }
    ]);
});

test("github discovery accepts only active public non-template Pages repositories", () => {
    const base = {
        name: "vectoriser",
        full_name: "kitty-crow/vectoriser",
        description: "Converts PNG to SVG",
        private: false,
        archived: false,
        disabled: false,
        has_pages: true,
        is_template: false
    };

    expect(githubRepoToApp(base)).toEqual({
        name: "vectoriser",
        href: "/vectoriser/",
        description: "Converts PNG to SVG",
        source: "github",
        repository: "kitty-crow/vectoriser"
    });

    expect(githubRepoToApp({ ...base, private: true })).toBeNull();
    expect(githubRepoToApp({ ...base, archived: true })).toBeNull();
    expect(githubRepoToApp({ ...base, disabled: true })).toBeNull();
    expect(githubRepoToApp({ ...base, has_pages: false })).toBeNull();
    expect(githubRepoToApp({ ...base, is_template: true })).toBeNull();
    expect(githubRepoToApp({ ...base, name: "app-kittycrow-dev" })).toBeNull();
});

test("merge is alphabetical and local nginx routes override matching github routes", () => {
    const githubApps: DiscoveredApp[] = [
        {
            name: "Vectoriser",
            href: "/vectoriser/",
            description: "GitHub copy",
            source: "github",
            repository: "kitty-crow/vectoriser"
        },
        {
            name: "Cube Solver",
            href: "/cube-solver",
            description: "Cube solver",
            source: "github",
            repository: "kitty-crow/cube-solver"
        }
    ];

    const localApps: DiscoveredApp[] = [
        {
            name: "Vectoriser Local",
            href: "/vectoriser/",
            description: "Local copy",
            source: "local"
        },
        {
            name: "FeLinE Market Tracker",
            href: "/feline/",
            description: "Local service",
            source: "local"
        }
    ];

    expect(mergeDiscoveredApps(githubApps, localApps)).toEqual([
        {
            name: "Cube Solver",
            href: "/cube-solver/",
            description: "Cube solver",
            source: "github",
            repository: "kitty-crow/cube-solver"
        },
        {
            name: "FeLinE Market Tracker",
            href: "/feline/",
            description: "Local service",
            source: "local"
        },
        {
            name: "Vectoriser Local",
            href: "/vectoriser/",
            description: "Local copy",
            source: "local"
        }
    ]);
});
