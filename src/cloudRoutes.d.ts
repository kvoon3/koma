/**
 * The cloud routes as the browser sees them. void's generated route map
 * imports the handlers to read their types, and a handler's types pull
 * Cloudflare's worker globals into the browser program, which override the
 * DOM's `Element.append`; so the browser program gets this declaration
 * instead. `routes/_cloudRoutes.check.ts` asserts it beside the generated map
 * in the program that can see both.
 */
import type { CloudProjectDetail, CloudProjectSummary } from './lib/cloudApi'

export interface CloudRouteMap {
  '/api/projects': {
    GET: { input: object, output: CloudProjectSummary[] }
    POST: { input: object, output: CloudProjectSummary }
  }
  '/api/projects/:id': {
    GET: { input: object, output: CloudProjectDetail }
    PUT: { input: object, output: CloudProjectSummary }
    DELETE: { input: object, output: { id: string } }
  }
}

declare module 'void/routes' {
  interface RouteMap extends CloudRouteMap {}
}
