import { queryGeneric, mutationGeneric, actionGeneric } from "convex/server";

export const query = queryGeneric;
export const mutation = mutationGeneric;
export const action = actionGeneric;
export type DatabaseReader = any;
export type DatabaseWriter = any;
export type MutationCtx = any;
export type QueryCtx = any;
export type ActionCtx = any;
