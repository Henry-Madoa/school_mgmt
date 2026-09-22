/** Shared password-strength rules, used both for the live checklist in the
 * admin UI and to enforce the same policy server-side in lib/admin.ts. */

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', '123456', '1234567', '12345678',
  '123456789', '1234567890', '111111', '000000', '123123', 'qwerty', 'qwerty123', 'qwertyuiop',
  'abc123', 'abcd1234', 'admin', 'admin123', 'welcome', 'welcome1', 'letmein', 'letmein1',
  'monkey', 'monkey123', 'football', 'football1', 'baseball', 'dragon', 'dragon123', 'master',
  'sunshine', 'princess', 'superman', 'batman', 'batman123', 'trustno1', 'whatever', 'freedom',
  'freedom1', 'hunter2', 'starwars', 'michael', 'michael1', 'jennifer', 'jordan23', 'shadow',
  'shadow123', 'iloveyou', '1q2w3e4r', 'zaq12wsx', 'qazwsx', 'passw0rd', 'p@ssw0rd', 'password!',
  'changeme', 'default', 'access', 'access123', 'hello123', 'secret', 'root', 'toor', 'guest',
  'test123', 'demo123', 'school123', 'school1234', 'student123', 'welcome123', 'charlie', 'donald',
]);

export interface PasswordCheckContext {
  username?: string | null;
}

export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string, ctx: PasswordCheckContext) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { id: 'upper', label: 'One uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { id: 'lower', label: 'One lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { id: 'number', label: 'One number', test: (pw) => /[0-9]/.test(pw) },
  { id: 'special', label: 'One special character', test: (pw) => /[^A-Za-z0-9\s]/.test(pw) },
  { id: 'spaces', label: 'No spaces', test: (pw) => pw.length > 0 && !/\s/.test(pw) },
  {
    id: 'common',
    label: 'Not a commonly used password',
    test: (pw) => pw.length === 0 || !COMMON_PASSWORDS.has(pw.toLowerCase()),
  },
  {
    id: 'username',
    label: "Doesn't contain the username",
    test: (pw, ctx) => {
      const uname = (ctx.username || '').trim().toLowerCase();
      return uname.length < 3 || pw.length === 0 || !pw.toLowerCase().includes(uname);
    },
  },
];

const RULE_MESSAGES: Record<string, string> = {
  length: 'Password must be at least 8 characters',
  upper: 'Password must include an uppercase letter',
  lower: 'Password must include a lowercase letter',
  number: 'Password must include a number',
  special: 'Password must include a special character',
  spaces: 'Password must not contain spaces',
  common: 'That password is too common — choose something less predictable',
  username: 'Password must not contain the username',
};

/** Returns the first unmet rule's error message, or null if the password satisfies all of them. */
export function passwordStrengthError(password: string, ctx: PasswordCheckContext = {}): string | null {
  const pw = password ?? '';
  const failed = PASSWORD_RULES.find((rule) => !rule.test(pw, ctx));
  return failed ? RULE_MESSAGES[failed.id] : null;
}
