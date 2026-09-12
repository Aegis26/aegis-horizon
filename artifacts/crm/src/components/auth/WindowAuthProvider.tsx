import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  clearWindowSession,
  configureWindowSessionTransport,
  establishWindowSession,
  readWindowSession,
  restoreWindowSession,
  type WindowAuthUser,
} from "@/lib/window-auth";
import { useOrgStore } from "@/store/org-store";

type LoginResult = { ok: true } | { ok: false; error: string; mfaRequired: boolean };
type WindowAuthValue = {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: WindowAuthUser | null;
  login: (email: string, password: string, totp?: string) => Promise<LoginResult>;
  signOut: () => Promise<void>;
};

const WindowAuthContext = createContext<WindowAuthValue | null>(null);

function apiPath(path: string): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api${path}`;
}

async function loadMe(token: string): Promise<WindowAuthUser | null> {
  try {
    const response = await fetch(apiPath("/auth/me"), {
      headers: { "x-aegis-window-session": token, accept: "application/json" },
      credentials: "omit",
    });
    if (!response.ok) return null;
    const payload = await response.json() as { user?: WindowAuthUser };
    return payload.user && typeof payload.user.id === "string" ? payload.user : null;
  } catch {
    return null;
  }
}

export function WindowAuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoaded, setLoaded] = useState(false);
  const [user, setUser] = useState<WindowAuthUser | null>(null);
  const queryClient = useQueryClient();
  const setSelectedOrgId = useOrgStore((state) => state.setSelectedOrgId);

  const reset = useCallback(() => {
    clearWindowSession();
    queryClient.clear();
    setSelectedOrgId(null);
    setUser(null);
  }, [queryClient, setSelectedOrgId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const session = await restoreWindowSession();
      if (!session) {
        if (active) setLoaded(true);
        return;
      }
      const serverUser = await loadMe(session.token);
      if (!active) return;
      if (!serverUser) {
        reset();
      } else {
        setUser(serverUser);
      }
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [reset]);

  const login = useCallback(async (
    email: string,
    password: string,
    totp?: string,
  ): Promise<LoginResult> => {
    const response = await fetch(apiPath("/auth/window/login"), {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
    });
    const payload = await response.json().catch(() => ({})) as {
      token?: string;
      expiresAt?: string;
      user?: WindowAuthUser;
      error?: string;
      mfaRequired?: boolean;
    };
    if (!response.ok || !payload.token || !payload.expiresAt || !payload.user) {
      return {
        ok: false,
        error: typeof payload.error === "string" ? payload.error : "Unable to sign in with those credentials",
        mfaRequired: payload.mfaRequired === true,
      };
    }
    if (!(await establishWindowSession({ token: payload.token, expiresAt: payload.expiresAt, user: payload.user }))) {
      // A token that cannot be safely retained must not remain usable.
      await fetch(apiPath("/auth/window/logout"), {
        method: "POST",
        credentials: "omit",
        headers: { "x-aegis-window-session": payload.token },
      }).catch(() => {});
      return { ok: false, error: "This browser cannot safely isolate this window session.", mfaRequired: false };
    }
    const verifiedUser = await loadMe(payload.token);
    if (!verifiedUser) {
      reset();
      return { ok: false, error: "Unable to sign in with those credentials", mfaRequired: false };
    }
    setUser(verifiedUser);
    setLoaded(true);
    return { ok: true };
  }, [reset]);

  const signOut = useCallback(async () => {
    const session = readWindowSession();
    // Revoke only this app window. Never call Clerk global signOut here.
    if (session) {
      let response: Response;
      try {
        response = await fetch(apiPath("/auth/window/logout"), {
          method: "POST",
          credentials: "omit",
          headers: { "x-aegis-window-session": session.token },
        });
      } catch {
        throw new Error("Unable to contact the server to revoke this window session.");
      }
      if (!response.ok) {
        throw new Error("The server did not revoke this window session.");
      }
    }
    reset();
  }, [reset]);

  const value = useMemo<WindowAuthValue>(() => ({
    isLoaded,
    isSignedIn: Boolean(user),
    user,
    login,
    signOut,
  }), [isLoaded, user, login, signOut]);

  return <WindowAuthContext.Provider value={value}>{children}</WindowAuthContext.Provider>;
}

export function useWindowAuth(): WindowAuthValue {
  const value = useContext(WindowAuthContext);
  if (!value) throw new Error("useWindowAuth must be used inside WindowAuthProvider");
  return value;
}