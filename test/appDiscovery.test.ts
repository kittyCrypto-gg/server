import { expect, test } from "bun:test";
import {
    applyAppDescriptions,
    appIdFromHref,
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

test("app ids are stable route-derived keys", () => {
    expect(appIdFromHref("/feline/")).toBe("feline");
    expect(appIdFromHref("/mae/activity/")).toBe("mae-activity");
    expect(appIdFromHref("/mikuOS/")).toBe("mikuOS");
});

test("local discovery finds only loopback-backed nginx applications", () => {
    expect(parseLocalAppsFromNginx(nginx)).toEqual([
        {
            id: "mae-activity",
            name: "Mae Discord Activity",
            href: "/mae/activity/",
            description: "",
            source: "local"
        },
        {
            id: "feline",
            name: "FeLinE Market Tracker",
            href: "/feline/",
            description: "",
            source: "local"
        },
        {
            id: "tarot",
            name: "Tarot WebApp",
            href: "/tarot/",
            description: "",
            source: "local"
        }
    ]);
});

test("github discovery accepts only active public non-template Pages repositories", () => {
    const base = {
        name: "vectoriser",
        full_name: "kitty-crow/vectoriser",
        description: "This GitHub description must not be used",
        private: false,
        archived: false,
        disabled: false,
        has_pages: true,
        is_template: false
    };

    expect(githubRepoToApp(base)).toEqual({
        id: "vectoriser",
        name: "vectoriser",
        href: "/vectoriser/",
        description: "",
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
            id: "vectoriser",
            name: "Vectoriser",
            href: "/vectoriser/",
            description: "",
            source: "github",
            repository: "kitty-crow/vectoriser"
        },
        {
            id: "cube-solver",
            name: "Cube Solver",
            href: "/cube-solver",
            description: "",
            source: "github",
            repository: "kitty-crow/cube-solver"
        }
    ];

    const localApps: DiscoveredApp[] = [
        {
            id: "vectoriser",
            name: "Vectoriser Local",
            href: "/vectoriser/",
            description: "",
            source: "local"
        },
        {
            id: "feline",
            name: "FeLinE Market Tracker",
            href: "/feline/",
            description: "",
            source: "local"
        }
    ];

    expect(mergeDiscoveredApps(githubApps, localApps)).toEqual([
        {
            id: "cube-solver",
            name: "Cube Solver",
            href: "/cube-solver/",
            description: "",
            source: "github",
            repository: "kitty-crow/cube-solver"
        },
        {
            id: "feline",
            name: "FeLinE Market Tracker",
            href: "/feline/",
            description: "",
            source: "local"
        },
        {
            id: "vectoriser",
            name: "Vectoriser Local",
            href: "/vectoriser/",
            description: "",
            source: "local"
        }
    ]);
});

test("descriptions are assigned only from the runtime description map", () => {
    const apps: DiscoveredApp[] = [
        {
            id: "vectoriser",
            name: "Vectoriser",
            href: "/vectoriser/",
            description: "should be replaced",
            source: "github",
            repository: "kitty-crow/vectoriser"
        },
        {
            id: "new-app",
            name: "New App",
            href: "/new-app/",
            description: "should also be replaced",
            source: "github",
            repository: "kitty-crow/new-app"
        }
    ];

    expect(applyAppDescriptions(apps, {
        vectoriser: "  Runtime controlled description.  "
    })).toEqual([
        {
            id: "vectoriser",
            name: "Vectoriser",
            href: "/vectoriser/",
            description: "Runtime controlled description.",
            source: "github",
            repository: "kitty-crow/vectoriser"
        },
        {
            id: "new-app",
            name: "New App",
            href: "/new-app/",
            description: "",
            source: "github",
            repository: "kitty-crow/new-app"
        }
    ]);
});
