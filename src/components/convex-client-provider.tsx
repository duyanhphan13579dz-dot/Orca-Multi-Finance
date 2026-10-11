"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

interface ConvexStatusContextType {
  isConfigured: boolean;
  client: ConvexReactClient | null;
}

const ConvexStatusContext = createContext<ConvexStatusContextType>({
  isConfigured: false,
  client: null,
});

export function useConvexStatus() {
  return useContext(ConvexStatusContext);
}

/**
 * ConvexClientProvider: Bọc ứng dụng trong Convex Reactive Provider.
 * Tự động kiểm tra an toàn: nếu chưa cấu hình `NEXT_PUBLIC_CONVEX_URL`,
 * ứng dụng vẫn hoạt động 100% trơn tru mà không bị throw exception.
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  const client = useMemo(() => {
    if (
      !convexUrl ||
      !convexUrl.startsWith("http") ||
      convexUrl.includes("placeholder") ||
      convexUrl.includes("your-deployment")
    ) {
      return null;
    }
    try {
      return new ConvexReactClient(convexUrl);
    } catch (e) {
      console.warn("[Convex] Khởi tạo client thất bại:", e);
      return null;
    }
  }, [convexUrl]);

  if (!client) {
    return (
      <ConvexStatusContext.Provider value={{ isConfigured: false, client: null }}>
        {children}
      </ConvexStatusContext.Provider>
    );
  }

  return (
    <ConvexStatusContext.Provider value={{ isConfigured: true, client }}>
      <ConvexProvider client={client}>{children}</ConvexProvider>
    </ConvexStatusContext.Provider>
  );
}
