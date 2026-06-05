// ui/src/views/Login.test.tsx
// Smoke test: the Login view renders the brand + credential form with the
// expected fields and primary action, wired to the AuthProvider + router.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../lib/auth";
import { Login } from "./Login";

// Stub the API so AuthProvider's initial /auth/me resolves without a backend.
vi.mock("../lib/api", async (orig) => {
  const actual = await orig<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn().mockRejectedValue(new actual.ApiError(401, "unauthenticated", "no session", "req-test")),
      login: vi.fn(),
    },
  };
});

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Login />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Login view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Castor brand logo", async () => {
    renderLogin();
    // AuthBrand renders the Castor wordmark + "Gérer · Déployer · Orchestrer"
    // tagline as a single logo image (see AuthBrand.tsx), so the brand is
    // surfaced via the image's accessible name, not as standalone text.
    const brand = await screen.findByRole("img", { name: "Castor" });
    expect(brand).toBeInTheDocument();
  });

  it("renders username + password fields and a sign-in button", () => {
    renderLogin();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("offers a link to initialize Castor (bootstrap)", () => {
    renderLogin();
    expect(screen.getByRole("link", { name: /initialize castor/i })).toBeInTheDocument();
  });
});
