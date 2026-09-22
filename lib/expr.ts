/*
 * A tiny, safe arithmetic evaluator for Financial Report formulas.
 *
 * Business Central's Account Schedule / Column Layout formulas are ordinary arithmetic over
 * other rows' Row No. or other columns' Column No. — e.g. `TINC-TEXP`, `(TY-LY)/LY*100`,
 * `CORE/TA*100`. This evaluates exactly that: `+ - * / ( )`, decimal literals, and bare
 * identifiers resolved through a caller-supplied map. No `eval`, no `Function` — a tokenizer
 * plus a recursive-descent parser, so a formula typed into the setup screen can never run code.
 *
 * Division by zero yields 0 (a ratio against an empty base reads as 0%, not NaN/∞), matching how
 * BC blanks such a cell rather than erroring the whole report.
 */

type Token = { kind: 'num'; value: number } | { kind: 'id'; value: string } | { kind: 'op'; value: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
      tokens.push({ kind: 'num', value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ kind: 'id', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/()'.includes(c)) { tokens.push({ kind: 'op', value: c }); i++; continue; }
    throw new Error(`Unexpected character "${c}" in formula`);
  }
  return tokens;
}

/**
 * Evaluate `formula` with each identifier resolved through `vars`. An unknown identifier is
 * treated as 0 (a row/column the formula names but that is hidden or not yet defined), so a
 * partially-built report still renders. Returns 0 for an empty formula.
 */
export function evalFormula(formula: string, vars: Record<string, number>): number {
  const src = String(formula ?? '').trim();
  if (!src) return 0;
  const tokens = tokenize(src);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const eat = (): Token => tokens[pos++];

  // expr := term (('+' | '-') term)*
  const parseExpr = (): number => {
    let left = parseTerm();
    while (peek()?.kind === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
      const op = eat().value;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  // term := factor (('*' | '/') factor)*
  const parseTerm = (): number => {
    let left = parseFactor();
    while (peek()?.kind === 'op' && (peek()!.value === '*' || peek()!.value === '/')) {
      const op = eat().value;
      const right = parseFactor();
      if (op === '*') left *= right;
      else left = right === 0 ? 0 : left / right;
    }
    return left;
  };

  // factor := ['-'] ( number | identifier | '(' expr ')' )
  const parseFactor = (): number => {
    const t = peek();
    if (!t) throw new Error('Unexpected end of formula');
    if (t.kind === 'op' && t.value === '-') { eat(); return -parseFactor(); }
    if (t.kind === 'op' && t.value === '+') { eat(); return parseFactor(); }
    if (t.kind === 'op' && t.value === '(') {
      eat();
      const inner = parseExpr();
      if (peek()?.value !== ')') throw new Error('Missing ")" in formula');
      eat();
      return inner;
    }
    if (t.kind === 'num') { eat(); return t.value; }
    if (t.kind === 'id') { eat(); return vars[t.value] ?? 0; }
    throw new Error(`Unexpected token "${t.value}" in formula`);
  };

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Trailing characters in formula');
  return Number.isFinite(result) ? result : 0;
}

/** Whether `formula` parses — surfaced by the setup validators. `vars` are irrelevant to syntax. */
export function isValidFormula(formula: string): boolean {
  try {
    evalFormula(formula || '0', {});
    return true;
  } catch {
    return false;
  }
}

/** The identifiers a formula references — used to check a formula only names known rows/columns. */
export function formulaIdentifiers(formula: string): string[] {
  try {
    return [...new Set(tokenize(String(formula ?? '')).filter((t) => t.kind === 'id').map((t) => t.value))];
  } catch {
    return [];
  }
}
