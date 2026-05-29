const INTERNAL_HOSTS = ['127.0.0.1', 'localhost'];

export function isIpAddress(host: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

export function validateUrl(inputUrl: string) {
  try {
    const u = new URL(inputUrl);
    if (u.protocol !== 'https:') throw new Error('URL must use https');
    const host = u.hostname.toLowerCase();
    if (INTERNAL_HOSTS.includes(host) || isIpAddress(host)) throw new Error('Internal hosts are not allowed');
    // basic allowed - further checks can be added
    return true;
  } catch (err: any) {
    const msg = err && err.message ? err.message : String(err);
    throw new Error(`Invalid target URL: ${msg}`);
  }
}

export async function validateFinalRedirects(initialUrl: string, maxRedirects = 5) {
  // Use global fetch (Node 18+/24). Use AbortController for timeout.
  let current = initialUrl;
  for (let i = 0; i < maxRedirects; i++) {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 5000);
    try {
      // follow redirects manually
      const res = await (global as any).fetch(current, { method: 'HEAD', redirect: 'manual', signal: ac.signal });
      clearTimeout(timeout);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        const next = new URL(loc, current).toString();
        current = next;
        const host = new URL(current).hostname.toLowerCase();
        if (INTERNAL_HOSTS.includes(host) || isIpAddress(host)) throw new Error('Redirects to internal hosts are blocked');
        continue;
      }
      break;
    } catch (e) {
      clearTimeout(timeout);
      // treat fetch errors as validation failure
      throw new Error(`Failed to validate redirects: ${String((e as any)?.message || e)}`);
    }
  }
  return true;
}

export default validateUrl;
