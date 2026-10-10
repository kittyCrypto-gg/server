import type { Request, Response } from "express";

export type methods = "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS";

export type RouteHandler = (
  req: Request,
  res: Response
) => void | Promise<void> | Promise<Response<unknown, Record<string, unknown>> | undefined>;

export interface Middleware {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
  name?: string;
  handle?: {
    stack?: Middleware[];
  };
}

