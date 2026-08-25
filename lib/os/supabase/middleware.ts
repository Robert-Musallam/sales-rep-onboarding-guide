import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/reps";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
