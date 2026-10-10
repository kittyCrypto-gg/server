import type { Request } from "express";
import type { methods } from "./types";

export interface CorsContext {
  publicCorsRoutes: Map<string, Set<methods>>
  readRequestedCorsMethod(req: Request): methods | undefined
  isKnownMethod(value: string | undefined): value is methods
  routeMatches(routePath: string, requestPath: string): boolean
}
  export function isPublicCorsRequest(ctx: CorsContext, req: Request): boolean {
    const requestedMethod = ctx.readRequestedCorsMethod(req);

    if (!requestedMethod) {
      return false;
    }

    for (const [routePath, routeMethods] of ctx.publicCorsRoutes) {
      if (!routeMethods.has(requestedMethod)) {
        continue;
      }

      if (ctx.routeMatches(routePath, req.path)) {
        return true;
      }
    }

    return false;
  }


  export function getPublicCorsMethods(ctx: CorsContext, requestPath: string): methods[] {
    const methodsForPath = new Set<methods>();

    for (const [routePath, routeMethods] of ctx.publicCorsRoutes) {
      if (!ctx.routeMatches(routePath, requestPath)) {
        continue;
      }

      for (const method of routeMethods) {
        methodsForPath.add(method);
      }
    }

    return Array.from(methodsForPath);
  }


  export function readRequestedCorsMethod(ctx: CorsContext, req: Request): methods | undefined {
    const requestMethod = req.method.toUpperCase();
    const candidate = requestMethod === "OPTIONS"
      ? req.header("access-control-request-method")?.toUpperCase()
      : requestMethod;

    return ctx.isKnownMethod(candidate) ? candidate : undefined;
  }


  export function isKnownMethod(ctx: CorsContext, value: string | undefined): value is methods {
    return value === "GET"
      || value === "POST"
      || value === "PUT"
      || value === "DELETE"
      || value === "OPTIONS";
  }


  export function routeMatches(ctx: CorsContext, routePath: string, requestPath: string): boolean {
    if (!routePath.endsWith("*")) {
      return routePath === requestPath;
    }

    const prefix = routePath.slice(0, -1);

    return requestPath.startsWith(prefix) && requestPath.length > prefix.length;
  }

