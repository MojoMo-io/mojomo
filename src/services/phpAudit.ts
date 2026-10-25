/**
 * Defensive PHP endpoint audit.
 *
 * Given a URL to a PHP application the caller owns, fetch it through the SSRF
 * guard and report the misconfigurations that actually get PHP apps compromised:
 * leaked secrets, exposed VCS metadata, reachable phpinfo, verbose errors that
 * disclose paths and credentials, directory listing, and missing security
 * headers.
 *
 * This is a read-only, non-intrusive audit. It performs GET/HEAD requests only.
 * It does not attempt injection, brute force, or exploitation of any kind.
 */

import { safeFetch } from './urlGuard';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence?: string;
  fix: string;
}

export interface AuditResult {
  url: string;
  reachable: boolean;
  status?: number;
  server?: string;
  powered_by?: string;
  findings: Finding[];
  score: number;
  checked_at: string;
}

const SEV_WEIGHT: Record<Severity, number> = {
  critical: 40, high: 20, medium: 8, low: 3, info: 0,
};

/** Paths that should never be publicly readable. */
const SENSITIVE_PATHS = [
  { path: '/.env', id: 'env-exposed', severity: 'critical' as Severity,
    title: '.env file is publicly readable',
    detail: 'Environment files routinely contain database credentials, API keys and APP_KEY. Exposure is a full compromise.',
    fix: 'Move .env outside the document root, or deny it in the web server config. Rotate every secret it contained.' },
  { path: '/.git/config', id: 'git-exposed', severity: 'critical' as Severity,
    title: '.git directory is publicly readable',
    detail: 'An exposed .git lets an attacker reconstruct full source history, including secrets that were committed and later removed.',
    fix: 'Deny /.git in the web server config and redeploy without the directory.' },
  { path: '/.svn/entries', id: 'svn-exposed', severity: 'high' as Severity,
    title: '.svn metadata is publicly readable',
    detail: 'Subversion metadata leaks source and history.',
    fix: 'Deny /.svn in the web server config.' },
  { path: '/phpinfo.php', id: 'phpinfo', severity: 'high' as Severity,
    title: 'phpinfo() is reachable',
    detail: 'phpinfo discloses PHP version, loaded extensions, document paths, and often environment variables including credentials.',
    fix: 'Delete the phpinfo file. Never deploy it to production.' },
  { path: '/composer.json', id: 'composer-exposed', severity: 'medium' as Severity,
    title: 'composer.json is publicly readable',
    detail: 'Reveals exact dependency versions, which maps directly to known CVEs.',
    fix: 'Deny composer.json and composer.lock in the web server config.' },
  { path: '/composer.lock', id: 'composer-lock', severity: 'medium' as Severity,
    title: 'composer.lock is publicly readable',
    detail: 'Pins exact dependency versions, enabling targeted CVE selection.',
    fix: 'Deny composer.lock in the web server config.' },
  { path: '/storage/logs/laravel.log', id: 'laravel-log', severity: 'high' as Severity,
    title: 'Laravel log is publicly readable',
    detail: 'Application logs frequently contain stack traces, SQL, session tokens and credentials.',
    fix: 'Move storage outside the document root or deny /storage in the web server config.' },
  { path: '/.htaccess', id: 'htaccess', severity: 'low' as Severity,
    title: '.htaccess is readable',
    detail: 'Discloses rewrite rules and sometimes auth configuration.',
    fix: 'Deny dotfiles in the web server config.' },
];

const SECURITY_HEADERS = [
  { header: 'x-content-type-options', id: 'hdr-nosniff', severity: 'low' as Severity,
    title: 'Missing X-Content-Type-Options',
    detail: 'Browsers may MIME-sniff responses, enabling content-type confusion attacks.',
    fix: 'Send X-Content-Type-Options: nosniff.' },
  { header: 'x-frame-options', id: 'hdr-frame', severity: 'medium' as Severity,
    title: 'Missing X-Frame-Options',
    detail: 'The app can be framed, enabling clickjacking.',
    fix: 'Send X-Frame-Options: DENY (or SAMEORIGIN), or a frame-ancestors CSP.' },
  { header: 'strict-transport-security', id: 'hdr-hsts', severity: 'medium' as Severity,
    title: 'Missing Strict-Transport-Security',
    detail: 'Without HSTS, downgrade and cookie-hijacking attacks remain possible.',
    fix: 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains.' },
  { header: 'content-security-policy', id: 'hdr-csp', severity: 'low' as Severity,
    title: 'Missing Content-Security-Policy',
    detail: 'No CSP means no defence-in-depth against XSS.',
    fix: 'Send a restrictive Content-Security-Policy.' },
];

/** Patterns in a response body that indicate verbose error disclosure. */
const ERROR_LEAKS = [
  { re: /(Fatal error|Parse error|Warning|Notice):\s+.{0,200}?in\s+\/[^\s]+\.php/i, id: 'err-path',
    severity: 'high' as Severity, title: 'PHP errors disclose server file paths',
    detail: 'Error output reveals absolute paths, which aids targeted attacks and reveals deployment layout.',
    fix: 'Set display_errors=Off and log_errors=On in production.' },
  { re: /Stack trace:/i, id: 'err-stack', severity: 'medium' as Severity,
    title: 'Stack traces are exposed',
    detail: 'Stack traces reveal framework internals, file paths and sometimes query fragments.',
    fix: 'Disable debug mode in production (e.g. APP_DEBUG=false in Laravel).' },
  { re: /SQLSTATE\[|mysqli?_error|PDOException/i, id: 'err-sql', severity: 'high' as Severity,
    title: 'Database errors are exposed',
    detail: 'SQL errors disclose schema, query structure and sometimes credentials.',
    fix: 'Catch and log database exceptions; never render them to the client.' },
  { re: /(DB_PASSWORD|DB_USERNAME|APP_KEY|AWS_SECRET|SECRET_KEY)\s*[=:]/i, id: 'err-secret',
    severity: 'critical' as Severity, title: 'Credentials appear in the response body',
    detail: 'A secret key name and value pattern was found in the response.',
    fix: 'Remove the disclosure immediately and rotate the exposed secret.' },
];

/** Version banners that map to known-vulnerable PHP releases. */
const PHP_VERSION_RE = /PHP\/(\d+)\.(\d+)\.(\d+)/i;

function versionFindings(server: string | undefined, poweredBy: string | undefined): Finding[] {
  const out: Finding[] = [];
  const hay = `${server || ''} ${poweredBy || ''}`;
  const m = hay.match(PHP_VERSION_RE);
  if (m) {
    const [, maj, min, patch] = m.map(Number) as unknown as number[];
    out.push({
      id: 'php-version-disclosed',
      severity: 'medium',
      title: `PHP version disclosed (${maj}.${min}.${patch})`,
      detail: 'Advertising the exact PHP version lets an attacker match it to known CVEs without probing.',
      evidence: m[0],
      fix: 'Set expose_php=Off in php.ini.',
    });
    // PHP < 8.1 is end-of-life and receives no security fixes.
    if (maj < 8 || (maj === 8 && min < 1)) {
      out.push({
        id: 'php-eol',
        severity: 'high',
        title: `PHP ${maj}.${min} is end-of-life`,
        detail: 'This branch no longer receives security patches. Known vulnerabilities will not be fixed.',
        evidence: m[0],
        fix: 'Upgrade to a supported PHP release (8.2 or later).',
      });
    }
  }
  return out;
}

async function probePath(base: string, path: string): Promise<Response | null> {
  try {
    const u = new URL(path, base).toString();
    return await safeFetch(u, { method: 'GET' });
  } catch {
    return null;
  }
}

export async function auditPhpEndpoint(rawUrl: string): Promise<AuditResult> {
  const findings: Finding[] = [];
  const checked_at = new Date().toISOString();

  let res: Response;
  try {
    res = await safeFetch(rawUrl, { method: 'GET' });
  } catch (e: any) {
    return {
      url: rawUrl, reachable: false, findings: [{
        id: 'unreachable', severity: 'info', title: 'Endpoint not reachable',
        detail: String(e?.message || e),
        fix: 'Confirm the URL is correct and publicly reachable.',
      }], score: 0, checked_at,
    };
  }

  const server = res.headers.get('server') || undefined;
  const poweredBy = res.headers.get('x-powered-by') || undefined;
  const body = await res.text().catch(() => '');

  findings.push(...versionFindings(server, poweredBy));

  if (poweredBy && /php/i.test(poweredBy)) {
    findings.push({
      id: 'x-powered-by', severity: 'low', title: 'X-Powered-By discloses PHP',
      detail: 'The header advertises the backend stack.',
      evidence: poweredBy,
      fix: 'Set expose_php=Off in php.ini.',
    });
  }

  for (const h of SECURITY_HEADERS) {
    if (!res.headers.get(h.header)) {
      findings.push({ id: h.id, severity: h.severity, title: h.title, detail: h.detail, fix: h.fix });
    }
  }

  for (const leak of ERROR_LEAKS) {
    const m = body.match(leak.re);
    if (m) {
      findings.push({
        id: leak.id, severity: leak.severity, title: leak.title, detail: leak.detail,
        evidence: m[0].slice(0, 160), fix: leak.fix,
      });
    }
  }

  // Directory listing on the root.
  if (/<title>\s*Index of \//i.test(body)) {
    findings.push({
      id: 'dir-listing', severity: 'medium', title: 'Directory listing is enabled',
      detail: 'The server renders a file index, exposing files not meant to be browsed.',
      fix: 'Set Options -Indexes (Apache) or autoindex off (nginx).',
    });
  }

  // Sensitive paths — only probe a handful, politely.
  for (const p of SENSITIVE_PATHS) {
    const r = await probePath(rawUrl, p.path);
    if (!r) continue;
    if (r.status === 200) {
      const t = await r.text().catch(() => '');
      // Guard against soft-404s that return 200 with the app's error page.
      const looksReal =
        p.path === '/.env' ? /^[A-Z0-9_]+\s*=/m.test(t) :
        p.path === '/.git/config' ? /\[core\]/i.test(t) :
        p.path === '/phpinfo.php' ? /phpinfo\(\)|PHP Version/i.test(t) :
        p.path === '/composer.json' ? /"require"|"name"/.test(t) :
        p.path === '/composer.lock' ? /"packages"/.test(t) :
        p.path === '/storage/logs/laravel.log' ? /\[\d{4}-\d{2}-\d{2}/.test(t) :
        p.path === '/.htaccess' ? /^\s*(RewriteEngine|Options|Order|Deny|Allow|AuthType|AddType|DirectoryIndex)\b/im.test(t) :
        p.path === '/.svn/entries' ? /^\d+\s*$/m.test(t) || /dir\s*$/m.test(t) :
        t.length > 0;
      if (looksReal) {
        findings.push({
          id: p.id, severity: p.severity, title: p.title, detail: p.detail,
          evidence: `GET ${p.path} -> 200`, fix: p.fix,
        });
      }
    }
  }

  const penalty = findings.reduce((a, f) => a + SEV_WEIGHT[f.severity], 0);
  const score = Math.max(0, 100 - penalty);

  return {
    url: rawUrl,
    reachable: true,
    status: res.status,
    server,
    powered_by: poweredBy,
    findings: findings.sort((a, b) => SEV_WEIGHT[b.severity] - SEV_WEIGHT[a.severity]),
    score,
    checked_at,
  };
}

export default { auditPhpEndpoint };
