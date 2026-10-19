import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { HOLDING_OS_RNB_URL } from "@/lib/holdingOs";

/**
 * The admin screens were switched off on 2026-10-19: these paths go to Holding
 * OS → RNB before any session check, so an anonymous visitor is not asked to
 * sign in to a screen that no longer exists. /login stays reachable on its
 * own, for the Microsoft consent; /my/<token>, /intake/<token>, /guide/* and
 * /api/* are untouched.
 */
const RETIRED = /^\/(reps|settings|training|intake|guide)?$/;

/**
 * Refreshes the Supabase auth session on every request and redirects
 * unauthenticated users to /login.
 *
 * Public paths: /login, /auth, /api (routes 401 themselves), and the two
 * token-authenticated surfaces whose secret lives in the URL instead of a
 * Supabase session — /my/<token> (the rep hub; reps have no login) and
 * /intake/<token> (the per-city intake form; the managers who file reps have no
 * login either). Bare /intake stays behind the session: it is the signed-in
 * version of the same form, and only the tokenized path is public.
 */
export async function updateSession(request: NextRequest) {
  if (RETIRED.test(request.nextUrl.pathname)) {
    return NextResponse.redirect(HOLDING_OS_RNB_URL);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/my") || // rep hub — token-authenticated, no Supabase session
    /^\/intake\/[^/]+$/.test(path) || // per-city intake link — token in the URL, not /intake itself
    path.startsWith("/guide") || // static manager's guide (public/guide/)
    path.startsWith("/api") || // API routes enforce auth themselves (return 401, not redirect)
    path.startsWith("/_next") ||
    path === "/favicon.ico";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Already signed in (e.g. right after the Microsoft consent): there is
  // nothing to show here, so go where the screens are.
  if (user && path.startsWith("/login")) {
    return NextResponse.redirect(HOLDING_OS_RNB_URL);
  }

  return supabaseResponse;
}
