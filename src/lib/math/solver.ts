/**
 * Tiny exact-ish arithmetic and one-variable linear equation solver.
 *
 * The recogniser only needs a safe subset: numbers, x, + − × ÷, parentheses
 * and equality. Parsing to a linear polynomial (`a·x + b`) lets the same code
 * evaluate arithmetic and solve equations, with no `eval` and no dependency.
 */

export type MathSolutionKind =
  | 'value'
  | 'equation'
  | 'identity'
  | 'none'
  | 'true'
  | 'false'
  | 'unsupported'
  | 'empty';

export interface MathSolution {
  kind: MathSolutionKind;
  normalized: string;
  result?: string;
  steps: string[];
  error?: string;
}

interface Linear {
  a: number;
  b: number;
}

const EPSILON = 1e-9;

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '∅';
  if (Math.abs(value) < EPSILON) return '0';
  const rounded = Math.round(value * 1e8) / 1e8;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Normalises display operators and inserts implicit multiplication. */
export function normalizeMathInput(input: string): string {
  let text = input
    .replace(/[−–—]/g, '-')
    .replace(/[×✕✖]/g, '*')
    .replace(/[÷∕]/g, '/')
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  text = text.replace(/(\d|\)|x)\s*(?=x|\()/g, '$1*');
  text = text.replace(/(x|\))\s*(?=\d)/g, '$1*');
  text = text.replace(/\s+/g, '');
  return text;
}

class MathParseError extends Error {}

class Parser {
  private readonly tokens: string[];
  private index = 0;

  constructor(expression: string) {
    this.tokens = expression.match(/\d+(?:\.\d+)?|x|[+\-*/()]/g) ?? [];
    if (this.tokens.join('') !== expression) {
      throw new MathParseError('Unsupported symbol');
    }
  }

  parse(): Linear {
    if (!this.tokens.length) throw new MathParseError('Empty expression');
    const value = this.expression();
    if (this.index < this.tokens.length) throw new MathParseError('Unexpected token');
    return value;
  }

  private expression(): Linear {
    let left = this.term();
    while (this.peek() === '+' || this.peek() === '-') {
      const operator = this.next();
      const right = this.term();
      left = operator === '+' ? { a: left.a + right.a, b: left.b + right.b } : { a: left.a - right.a, b: left.b - right.b };
    }
    return left;
  }

  private term(): Linear {
    let left = this.unary();
    while (this.peek() === '*' || this.peek() === '/') {
      const operator = this.next();
      const right = this.unary();
      if (operator === '*') {
        if (Math.abs(left.a) > EPSILON && Math.abs(right.a) > EPSILON) {
          throw new MathParseError('Only linear equations are supported');
        }
        left = { a: left.a * right.b + right.a * left.b, b: left.b * right.b };
      } else {
        if (Math.abs(right.a) > EPSILON) throw new MathParseError('Cannot divide by x');
        if (Math.abs(right.b) < EPSILON) throw new MathParseError('Division by zero');
        left = { a: left.a / right.b, b: left.b / right.b };
      }
    }
    return left;
  }

  private unary(): Linear {
    if (this.peek() === '+') {
      this.next();
      return this.unary();
    }
    if (this.peek() === '-') {
      this.next();
      const value = this.unary();
      return { a: -value.a, b: -value.b };
    }
    return this.primary();
  }

  private primary(): Linear {
    const token = this.next();
    if (token === undefined) throw new MathParseError('Unexpected end');
    if (token === '(') {
      const value = this.expression();
      if (this.next() !== ')') throw new MathParseError('Missing closing parenthesis');
      return value;
    }
    if (token === 'x') return { a: 1, b: 0 };
    if (/^\d/.test(token)) {
      const parsed = Number(token);
      if (!Number.isFinite(parsed)) throw new MathParseError('Invalid number');
      return { a: 0, b: parsed };
    }
    throw new MathParseError(`Unexpected «${token}»`);
  }

  private peek(): string | undefined {
    return this.tokens[this.index];
  }

  private next(): string | undefined {
    return this.tokens[this.index++];
  }
}

function evaluateExpression(expression: string): Linear {
  return new Parser(expression).parse();
}

export function solveMathInput(raw: string): MathSolution {
  const normalized = normalizeMathInput(raw);
  if (!normalized) {
    return { kind: 'empty', normalized: '', steps: [] };
  }
  if (!/^[0-9x+\-*/().=]+$/.test(normalized)) {
    return { kind: 'unsupported', normalized, steps: [], error: 'Only numbers, x, + − × ÷ and = are supported.' };
  }
  const parts = normalized.split('=');
  if (parts.length > 2) {
    return { kind: 'unsupported', normalized, steps: [], error: 'Only one equals sign is supported.' };
  }

  try {
    if (parts.length === 1) {
      const value = evaluateExpression(parts[0]);
      if (Math.abs(value.a) < EPSILON) {
        return {
          kind: 'value',
          normalized,
          result: formatNumber(value.b),
          steps: [`${parts[0]} = ${formatNumber(value.b)}`],
        };
      }
      return {
        kind: 'unsupported',
        normalized,
        steps: [],
        error: 'Add an equals sign to solve for x.',
      };
    }

    const left = evaluateExpression(parts[0]);
    const right = evaluateExpression(parts[1]);

    // A numeric statement such as 2 + 3 = 5 is not an equation in x. Treat it
    // as a check instead of the confusing “true for every x” wording.
    if (Math.abs(left.a) < EPSILON && Math.abs(right.a) < EPSILON) {
      const equal = Math.abs(left.b - right.b) < 1e-8;
      return {
        kind: equal ? 'true' : 'false',
        normalized,
        result: `${formatNumber(left.b)} ${equal ? '=' : '≠'} ${formatNumber(right.b)}`,
        steps: [`${formatNumber(left.b)} ${equal ? '=' : '≠'} ${formatNumber(right.b)}`],
      };
    }

    const a = left.a - right.a;
    const b = left.b - right.b;
    if (Math.abs(a) < EPSILON) {
      return Math.abs(b) < EPSILON
        ? { kind: 'identity', normalized, steps: ['The equation is true for every x.'] }
        : { kind: 'none', normalized, steps: ['The equation has no solution.'] };
    }
    const answer = -b / a;
    const steps = [
      normalized,
      `${formatNumber(a)}x = ${formatNumber(-b)}`,
      `x = ${formatNumber(answer)}`,
    ];
    return {
      kind: 'equation',
      normalized,
      result: `x = ${formatNumber(answer)}`,
      steps,
    };
  } catch (error) {
    return {
      kind: 'unsupported',
      normalized,
      steps: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Used by the vertical arithmetic viewer. */
export function evaluateArithmetic(expression: string): number | null {
  try {
    const normalized = normalizeMathInput(expression);
    const value = evaluateExpression(normalized);
    if (Math.abs(value.a) > EPSILON) return null;
    return value.b;
  } catch {
    return null;
  }
}

export { formatNumber };
