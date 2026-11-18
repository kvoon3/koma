import type { RouteMap } from 'void/routes'
import type { CloudRouteMap } from '../src/cloudRoutes'

/**
 * Compile-time parity between the browser's cloud route declaration
 * (`src/cloudRoutes.d.ts`) and the handlers void generated. The declaration
 * is the browser program's substitute for the generated map, so drift would
 * otherwise go unseen; this file is the one program that sees both. A route
 * whose shape changes fails `bun run check-types` until the declaration
 * follows.
 */
type Assert<T extends true> = T
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
/** Inputs matter by their validator slots, not by the empty-object spelling. */
type SameKeys<A, B> = Same<keyof A, keyof B>

export type ProjectsListOutput = Assert<Same<CloudRouteMap['/api/projects']['GET']['output'], RouteMap['/api/projects']['GET']['output']>>
export type ProjectsListInput = Assert<SameKeys<CloudRouteMap['/api/projects']['GET']['input'], RouteMap['/api/projects']['GET']['input']>>
export type ProjectsCreateOutput = Assert<Same<CloudRouteMap['/api/projects']['POST']['output'], RouteMap['/api/projects']['POST']['output']>>
export type ProjectsCreateInput = Assert<SameKeys<CloudRouteMap['/api/projects']['POST']['input'], RouteMap['/api/projects']['POST']['input']>>
export type ProjectReadOutput = Assert<Same<CloudRouteMap['/api/projects/:id']['GET']['output'], RouteMap['/api/projects/:id']['GET']['output']>>
export type ProjectReadInput = Assert<SameKeys<CloudRouteMap['/api/projects/:id']['GET']['input'], RouteMap['/api/projects/:id']['GET']['input']>>
export type ProjectUpdateOutput = Assert<Same<CloudRouteMap['/api/projects/:id']['PUT']['output'], RouteMap['/api/projects/:id']['PUT']['output']>>
export type ProjectUpdateInput = Assert<SameKeys<CloudRouteMap['/api/projects/:id']['PUT']['input'], RouteMap['/api/projects/:id']['PUT']['input']>>
export type ProjectDeleteOutput = Assert<Same<CloudRouteMap['/api/projects/:id']['DELETE']['output'], RouteMap['/api/projects/:id']['DELETE']['output']>>
export type ProjectDeleteInput = Assert<SameKeys<CloudRouteMap['/api/projects/:id']['DELETE']['input'], RouteMap['/api/projects/:id']['DELETE']['input']>>
