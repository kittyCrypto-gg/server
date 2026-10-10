export type AppSource = "github" | "local";
export type AppDescriptions = Readonly<Record<string, string>>;

export interface DiscoveredApp {
    id: string;
    name: string;
    href: string;
    description: string;
    source: AppSource;
    repository?: string;
}

export interface AppDiscoverySnapshot {
    generatedAt: string | null;
    apps: readonly DiscoveredApp[];
}

export interface GithubRepository {
    name: string;
    full_name: string;
    private: boolean;
    archived: boolean;
    disabled: boolean;
    has_pages: boolean;
    is_template: boolean;
}
