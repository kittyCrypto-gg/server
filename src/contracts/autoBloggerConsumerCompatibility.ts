import { autoBlogger } from "../autoBlogger";
import type { CommitLog, CommitEntry, ModeratorStrings } from "../autoBlogger";
import type { OpenAI } from "openai";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ExistingConstructor = Assert<Equal<ConstructorParameters<typeof autoBlogger>, [
  owner: string,
  repo: string,
  openai: OpenAI,
  strings: { [key: string]: ModeratorStrings }
]>>;
type LatestContract = Assert<Equal<Parameters<autoBlogger["summariseLatest"]>, [user?: string, spellCheck?: boolean]>>;
type AllContract = Assert<Equal<Parameters<autoBlogger["summariseAll"]>, [user?: string, spellCheck?: boolean]>>;
type LatestResult = Assert<Equal<ReturnType<autoBlogger["summariseLatest"]>, Promise<string[]>>>;
type AllResult = Assert<Equal<ReturnType<autoBlogger["summariseAll"]>, Promise<string[]>>>;
type CommitShape = Assert<Equal<CommitLog["commits"][number], CommitEntry>>;

export type AutoBloggerConsumerCompatibility = ExistingConstructor | LatestContract | AllContract | LatestResult | AllResult | CommitShape;
