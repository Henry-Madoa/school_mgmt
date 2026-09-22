/*
 * /WS/… — Business Central's SOAP endpoint (lib/webServices/soap.ts): ?wsdl on GET, envelopes on
 * POST. Authenticates with HTTP Basic (username + Web Service Access Key) or the session cookie;
 * WSDL is served without authentication so tooling can import it. Every call is logged.
 */
import { authenticateRequest, logCall, WsError } from '@/lib/webServices';
import { handleSoap, faultFor } from '@/lib/webServices/soap';
import { companyRegistry, withCompany } from '@/lib/db';
import { rateLimit, clientIp, tooManyRequests, LIMITS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path?: string[] }> };

async function serve(request: Request, ctx: Ctx): Promise<Response> {
  const started = Date.now();
  const { path = [] } = await ctx.params;
  const url = new URL(request.url);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null;
  // Per-address throttle before any work: a tighter one until the caller has authenticated.
  {
    const addr = clientIp(request.headers);
    const all = rateLimit(`ws:${addr}`, LIMITS.webServicePerIp.limit, LIMITS.webServicePerIp.windowMs);
    if (!all.ok) return tooManyRequests(all);
    const unauth = rateLimit(`ws-unauth:${addr}`, LIMITS.webServiceUnauthPerIp.limit, LIMITS.webServiceUnauthPerIp.windowMs);
    if (!request.headers.get('authorization') && !request.headers.get('cookie') && !unauth.ok) return tooManyRequests(unauth);
  }
  let username: string | null = null;
  let result;
  try {
    // /WS/<Company>/Page/… names the company the call runs in (BC's URL shape); a segment that
    // is not a known company code is treated as no company (the live one).
    const kindIdx = path.findIndex((s) => /^(page|codeunit|systemservice)$/i.test(s));
    const code = kindIdx > 0 ? decodeURIComponent(path[0]) : null;
    const company = code ? (await companyRegistry()).find((c) => c.code.toUpperCase() === code.toUpperCase()) : null;
    if (code && !company) {
      result = faultFor(new WsError(404, 'NotFound', `Company '${code}' does not exist`));
    } else {
      result = await withCompany(company?.schema_name ?? 'public', async () => {
        const user = await authenticateRequest(request);
        username = user?.username ?? null;
        if (user?.webServiceKey?.ratePerMinute) {
          const own = rateLimit(`ws-key:${user.webServiceKey.id}`, user.webServiceKey.ratePerMinute, 60_000);
          if (!own.ok) throw new WsError(429, 'TooManyRequests', `This access key is limited to ${user.webServiceKey.ratePerMinute} requests a minute`);
        }
        return handleSoap(request, path, user, company ? `${url.origin}/WS/${company.code}` : `${url.origin}/WS`);
      });
    }
  } catch (e) {
    result = faultFor(e);
  }
  const headers: Record<string, string> = { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' };
  if (result.status === 401) headers['WWW-Authenticate'] = 'Basic realm="Web Services"';
  const fault = result.xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] ?? null;
  logCall({
    protocol: 'SOAP', method: request.method, serviceName: result.serviceName ?? path.find((s, i) => i > 0 && /^(page|codeunit)$/i.test(path[i - 1] ?? '')) ?? path[path.length - 1] ?? null,
    operation: result.operation ?? null, path: url.pathname + url.search, username, status: result.status, durationMs: Date.now() - started, ip, error: fault,
  });
  return new Response(result.xml, { status: result.status, headers });
}

export const GET = serve;
export const POST = serve;
