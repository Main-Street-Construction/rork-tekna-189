/**
 * Practical email checks for signup/signin/reset.
 * Format is intentionally permissive for business domains; typo hints
 * only apply to well-known consumer providers (gmail, yahoo, etc.).
 */

const EMAIL_FORMAT =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/** Consumer inboxes where TLD/domain typos are common */
const CONSUMER_LABELS = new Set([
  'gmail',
  'googlemail',
  'yahoo',
  'ymail',
  'hotmail',
  'outlook',
  'live',
  'msn',
  'icloud',
  'me',
  'mac',
  'aol',
  'protonmail',
  'proton',
  'icloud',
]);

/** Full-domain typos for consumer providers only */
const CONSUMER_DOMAIN_TYPOS: Record<string, string> = {
  'gmail.ney': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cpm': 'gmail.com',
  'gmail.cmo': 'gmail.com',
  'gmail.comm': 'gmail.com',
  'gmail.coom': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'googlemail.con': 'googlemail.com',
  'googlemail.ney': 'googlemail.com',
  'yahoo.con': 'yahoo.com',
  'yahoo.ney': 'yahoo.com',
  'yahoo.cpm': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'hotmail.con': 'hotmail.com',
  'hotmail.ney': 'hotmail.com',
  'outlook.con': 'outlook.com',
  'outlook.ney': 'outlook.com',
  'icloud.con': 'icloud.com',
  'icloud.ney': 'icloud.com',
  'aol.con': 'aol.com',
  'aol.ney': 'aol.com',
  'msn.con': 'msn.com',
  'live.con': 'live.com',
  'live.ney': 'live.com',
  'protonmail.con': 'protonmail.com',
  'proton.me.con': 'proton.me',
};

/** Obvious non-TLD typos — only applied when the registrable label is a consumer provider */
const CONSUMER_TLD_TYPOS: Record<string, string> = {
  ney: 'com',
  nett: 'net',
  ent: 'net',
  con: 'com',
  cpm: 'com',
  cmo: 'com',
  ocm: 'com',
  comm: 'com',
  coom: 'com',
  bom: 'com',
  vom: 'com',
  xom: 'com',
  cim: 'com',
  nte: 'net',
  ogr: 'org',
  orgg: 'org',
};

export type EmailValidationResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

function isConsumerDomain(domain: string): boolean {
  const labels = domain.split('.').filter(Boolean);
  if (labels.length < 2) return false;
  // mail.google.com → google; gmail.com → gmail; smtp.company.co.uk → company
  const registrable = labels.length >= 3 && labels[labels.length - 1].length === 2
    ? labels[labels.length - 3] // foo.co.uk → foo
    : labels[labels.length - 2];
  return CONSUMER_LABELS.has(registrable);
}

export function validateEmailAddress(raw: string): EmailValidationResult {
  const email = raw.trim().toLowerCase();

  if (!email) {
    return { ok: false, error: 'Please enter your email address.' };
  }

  if (/\s/.test(email)) {
    return { ok: false, error: 'Email addresses can’t contain spaces. Please try again.' };
  }

  const atParts = email.split('@');
  if (atParts.length !== 2) {
    return {
      ok: false,
      error: 'That doesn’t look like an email address. Use a format like name@example.com.',
    };
  }

  const [local, domain] = atParts;
  if (!local || !domain) {
    return {
      ok: false,
      error: 'That doesn’t look like an email address. Use a format like name@example.com.',
    };
  }

  if (!domain.includes('.')) {
    return {
      ok: false,
      error: 'Email domain is incomplete (needs something like .com or your company domain). Please try again.',
    };
  }

  // Allow normal business addresses: subdomains, hyphens, +tags, longer TLDs (.io, .agency, .co.uk)
  if (!EMAIL_FORMAT.test(email) || email.length > 254) {
    return {
      ok: false,
      error: 'That doesn’t look like a valid email address. Please check it and try again.',
    };
  }

  const labels = domain.split('.');
  const tld = labels[labels.length - 1] ?? '';
  // Real TLDs are at least 2 chars; allow letters (com, io) and rare alphanumeric TLDs
  if (tld.length < 2 || !/^[a-z0-9]+$/.test(tld)) {
    return {
      ok: false,
      error: 'That email ending looks incomplete. Please check the domain and try again.',
    };
  }

  // Typo hints only for consumer mail hosts — never rewrite business domains
  if (isConsumerDomain(domain)) {
    const domainFix = CONSUMER_DOMAIN_TYPOS[domain];
    if (domainFix) {
      return {
        ok: false,
        error: `Did you mean ${local}@${domainFix}? Please correct your email and try again.`,
      };
    }

    const tldFix = CONSUMER_TLD_TYPOS[tld];
    if (tldFix) {
      const correctedDomain = [...labels.slice(0, -1), tldFix].join('.');
      return {
        ok: false,
        error: `Did you mean ${local}@${correctedDomain}? Please correct your email and try again.`,
      };
    }
  }

  return { ok: true, email };
}
