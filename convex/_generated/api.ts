import { anyApi } from "convex/server";

/**
 * A utility for referencing Convex functions in client code.
 * Khi chạy `npx convex dev`, file này sẽ được thay thế bằng danh sách API types đầy đủ.
 */
export const api: any = anyApi;
export const internal: any = anyApi;
