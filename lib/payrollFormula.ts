/*
 * Payroll transaction-code formulas — AL Cod52203433 fnPureFormula / fnFormulaResult.
 *
 * A formula on a Payroll Transaction Code reads like `[BPAY]*0.15` or `([BPAY]+[HALLOW])*0.05`:
 * each `[CODE]` is the amount of one of the employee's Payroll Period Transactions already
 * computed in this run (AL fnGetTransAmount reads the Payroll Period Transaction table), and
 * the rest is ordinary arithmetic, which AL hands to the account-schedule expression engine.
 * Here the substitution is the same and the arithmetic is evaluated by a small parser —
 * numbers, + − × ÷ ^ %, parentheses — never by eval().
 */

/** The amount (cents) of a period transaction by code; unknown codes are 0, as in AL. */
export type FormulaLookup = (code: string) => number | undefined;

/** Every `[CODE]` the formula refers to, in order, without the brackets. */
export function formulaCodes(formula: string): string[] {
  return [...formula.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim().toUpperCase());
}

/**
 * Evaluates `formula` in cents against `lookup` (amounts in cents) and returns whole cents.
 * Throws on a malformed expression, naming the problem, so a bad formula is caught when the
 * code is saved rather than in the middle of a payroll run.
 */
export function evaluateFormula(formula: string, lookup: FormulaLookup): number {
  const src = formula.trim();
  if (!src) throw new Error('The formula is empty');
  // AL fnPureFormula: swap every [CODE] for its amount, then evaluate what is left.
  const expr = src.replace(/\[([^\]]+)\]/g, (_m, code: string) => {
    const v = lookup(code.trim().toUpperCase());
    return String((v ?? 0) / 100);
  });
  const value = new Parser(expr).parse();
  if (!Number.isFinite(value)) throw new Error('The formula does not evaluate to a number');
  return Math.round(value * 100);
}

/** Validates a formula's syntax (codes resolve to 1 so a division never trips on 0). */
export function assertFormulaValid(formula: string): void {
  evaluateFormula(formula, () => 100);
}

/** Recursive-descent arithmetic: expr = term (('+'|'-') term)*; term = power (('*'|'/'|'%') power)*;
 *  power = unary ('^' power)?; unary = ('+'|'-') unary | atom; atom = number | '(' expr ')'. */
class Parser {
  private i = 0;
  private readonly s: string;
  constructor(s: string) { this.s = s; }

  parse(): number {
    const v = this.expr();
    this.ws();
    if (this.i < this.s.length) throw new Error(`Unexpected "${this.s[this.i]}" at position ${this.i + 1} of the formula`);
    return v;
  }

  private ws(): void { while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i += 1; }
  private peek(): string { this.ws(); return this.s[this.i] ?? ''; }
  private take(): string { this.ws(); return this.s[this.i++] ?? ''; }

  private expr(): number {
    let v = this.term();
    for (;;) {
      const c = this.peek();
      if (c === '+') { this.take(); v += this.term(); }
      else if (c === '-') { this.take(); v -= this.term(); }
      else return v;
    }
  }

  private term(): number {
    let v = this.power();
    for (;;) {
      const c = this.peek();
      if (c === '*') { this.take(); v *= this.power(); }
      else if (c === '/') { this.take(); const d = this.power(); v = d === 0 ? 0 : v / d; }
      else if (c === '%') { this.take(); v = v / 100; }
      else return v;
    }
  }

  private power(): number {
    const base = this.unary();
    if (this.peek() === '^') { this.take(); return base ** this.power(); }
    return base;
  }

  private unary(): number {
    const c = this.peek();
    if (c === '-') { this.take(); return -this.unary(); }
    if (c === '+') { this.take(); return this.unary(); }
    return this.atom();
  }

  private atom(): number {
    const c = this.peek();
    if (c === '(') {
      this.take();
      const v = this.expr();
      if (this.take() !== ')') throw new Error('A closing bracket ")" is missing in the formula');
      return v;
    }
    const m = /^\d+(?:\.\d+)?|^\.\d+/.exec(this.s.slice(this.i));
    if (!m) {
      if (c === '') throw new Error('The formula ends before an amount');
      throw new Error(`Unexpected "${c}" in the formula — codes go in square brackets, e.g. [BPAY]`);
    }
    this.i += m[0].length;
    return Number(m[0]);
  }
}
