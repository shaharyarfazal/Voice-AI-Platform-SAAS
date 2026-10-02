import { NextResponse, type NextRequest } from "next/server";

// Cheap gate only: redirects visitors without a session cookie. Pages and routes verify the
// cookie signature themselves through requireSession()/getSession().
export function proxy(request: NextRequest) {
  if (!request.cookies.has("session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|signup|api/internal|api/health|_next/static|_next/image|favicon.ico).*)"],
};
