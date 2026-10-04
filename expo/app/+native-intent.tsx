/**
 * Expo Router calls this for OS deep links (email reset, universal links, etc.).
 * Returning "/" for every path was sending password-reset links to a dead end.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  const raw = (path || '').trim();
  if (!raw || raw === '/') return '/';

  let pathname = raw;
  let search = '';
  let hash = '';

  try {
    if (raw.includes('://')) {
      const url = new URL(raw);
      pathname = url.pathname || '/';
      search = url.search || '';
      hash = url.hash || '';
    } else {
      const hashIdx = raw.indexOf('#');
      const queryIdx = raw.indexOf('?');
      if (hashIdx >= 0) {
        hash = raw.slice(hashIdx);
        pathname = raw.slice(0, hashIdx);
      }
      const qFrom = pathname.indexOf('?');
      if (qFrom >= 0) {
        search = pathname.slice(qFrom);
        pathname = pathname.slice(0, qFrom);
      } else if (queryIdx >= 0 && hashIdx < 0) {
        search = raw.slice(queryIdx);
        pathname = raw.slice(0, queryIdx);
      }
    }
  } catch {
    pathname = raw.split('?')[0].split('#')[0] || '/';
  }

  if (!pathname.startsWith('/')) pathname = `/${pathname}`;

  const combined = `${pathname}${search}${hash}`;
  const isAuthDeepLink =
    pathname.startsWith('/update-password') ||
    pathname.startsWith('/auth') ||
    /(?:^|[?#&])(?:code|access_token|refresh_token|type)=/i.test(combined) ||
    /type=recovery/i.test(combined);

  if (isAuthDeepLink) {
    if (pathname.startsWith('/update-password') || /type=recovery/i.test(combined)) {
      return `/update-password${search}${hash}`;
    }
    return `${pathname}${search}${hash}`;
  }

  return '/';
}
