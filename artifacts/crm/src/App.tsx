import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { QueryClient } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';

import { Shell } from "@/components/layout/Shell";
import { AuthLayout } from "@/components/auth/AuthLayout";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Accounts from "@/pages/Accounts";
import Opportunities from "@/pages/Opportunities";
import Automation from "@/pages/Automation";
import Billing from "@/pages/Billing";
import Settings from "@/pages/Settings";
import { Button } from "react-day-picker";

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.png`,
  },
  variables: {
    colorPrimary: "hsl(192 100% 42%)",
    colorForeground: "hsl(216 33% 97%)",
    colorMutedForeground: "hsl(218 11% 46%)",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "hsl(232 59% 10%)",
    colorInput: "hsl(231 38% 16%)",
    colorInputForeground: "hsl(216 33% 97%)",
    colorNeutral: "hsl(231 38% 16%)",
    fontFamily: "'Public Sans', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#1A1F3A] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#00B4D8]/10 shadow-[0_4px_12px_rgba(0,0,0,0.3)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-2xl font-bold tracking-tight text-[#F5F7FA] font-display",
    headerSubtitle: "text-[#6B7280]",
    socialButtonsBlockButtonText: "font-medium text-[#F5F7FA]",
    formFieldLabel: "font-semibold text-[#F5F7FA] font-display",
    footerActionLink: "text-[#00B4D8] hover:text-[#00B4D8]/90 font-medium",
    footerActionText: "text-[#6B7280]",
    dividerText: "text-[#6B7280]",
    identityPreviewEditButton: "text-[#00B4D8] hover:text-[#00B4D8]/90",
    formFieldSuccessText: "text-[#10B981]",
    alertText: "text-[#EF4444]",
    logoBox: "h-12 w-12 mx-auto",
    logoImage: "object-contain",
    socialButtonsBlockButton: "border border-[#00B4D8]/20 hover:bg-[#0A0E27] transition-colors h-11",
    formButtonPrimary: "bg-[#00B4D8] text-[#0A0E27] hover:bg-[#00A0C0] h-11 font-semibold font-display shadow-[0_0_12px_rgba(0,180,216,0.4)]",
    formFieldInput: "flex h-10 w-full rounded-md border border-[#00B4D8]/20 bg-[#0A0E27]/50 px-3 py-2 text-sm placeholder:text-[#F5F7FA]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00B4D8] focus-visible:ring-offset-2",
    footerAction: "bg-[#0A0E27]/30 py-4 px-6 mt-4 border-t border-[#00B4D8]/10",
    dividerLine: "bg-[#00B4D8]/10",
    alert: "bg-[#EF4444]/10 border-[#EF4444] text-[#EF4444]",
    otpCodeFieldInput: "border-[#00B4D8]/20 border-2 text-lg font-mono focus:border-[#00B4D8]",
    formFieldRow: "space-y-2",
    main: "p-6 sm:p-8",
  },
};

function SignInPage() {
  return (
    <AuthLayout>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthLayout>
  );
}

function SignUpPage() {
  return (
    <AuthLayout>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthLayout>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Shell>
          <Component />
        </Shell>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to access Aegis Horizon",
          },
        },
        signUp: {
          start: {
            title: "Start building",
            subtitle: "Create your workspace today",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          
          <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
          <Route path="/accounts" component={() => <ProtectedRoute component={Accounts} />} />
          <Route path="/opportunities" component={() => <ProtectedRoute component={Opportunities} />} />
          <Route path="/automation" component={() => <ProtectedRoute component={Automation} />} />
          <Route path="/billing" component={() => <ProtectedRoute component={Billing} />} />
          <Route path="/settings" component={() => <ProtectedRoute component={Settings} />} />
          
          <Route>
            <div className="flex min-h-screen items-center justify-center bg-background">
              <div className="text-center space-y-4">
                <h1 className="text-4xl font-bold font-display text-foreground">404</h1>
                <p className="text-muted-foreground">Page not found</p>
                <Button onClick={() => setLocation("/")} className="font-display">Go Home</Button>
              </div>
            </div>
          </Route>
        </Switch>
        <Toaster />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
