// ui/src/App.tsx
// Root app: query client + auth provider + router + global toasts + error boundary.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { AuthProvider } from "./lib/auth";
import { Toasts } from "./components/Toasts";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ApiError } from "./lib/api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5000,
      retry: (failureCount, error) => {
        // Don't retry auth/permission/validation errors.
        if (error instanceof ApiError) {
          if ([400, 401, 403, 404, 405, 409, 422].includes(error.status)) return false;
        }
        return failureCount < 2;
      },
    },
  },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
          <Toasts />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
