export type GithubAutoSchedulerOptions = {
  owner: string;
  repos: string[];
  blogUser?: string;
  branch?: string;
  sinceDays?: number;
};
