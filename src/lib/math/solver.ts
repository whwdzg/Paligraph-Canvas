import { derivative, evaluate, lusolve, parse, simplify } from 'mathjs';

/**
 * Advanced local math evaluator.
 *
 * Math.js is used only inside the lazy math-dialog chunk. The handwriting
 * recognizer produces an editable expression; this file handles arithmetic,
 * variables, linear systems, symbolic derivatives, finite sums and numeric
 * roots for one-variable equations. Nothing is sent to a server.
 */


export type MathSolutionKind =
  | 'value'
  | 'equation'
  | 'system'
  | 'derivative'
  | 'sum'
  | 'expression'
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

const EPSILON = 1e-9;
const MAX_SUM_TERMS = 100_000;
const MAX_ROOTS = 4;

/** Rewrites log10/log2 calls into Math.js' base-aware log(x, base) form. */
function normalizeLogBases(source: string): string {
  let result = '';
  let index = 0;
  while (index < source.length) {
    const log10 = source.startsWith('log10(', index);
    const log2 = source.startsWith('log2(', index);
    if (!log10 && !log2) {
      result += source[index];
      index += 1;
      continue;
    }
    const nameLength = log10 ? 6 : 5;
    let depth = 1;
    let end = index + nameLength;
    while (end < source.length && depth > 0) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') depth -= 1;
      end += 1;
    }
    if (depth !== 0) {
      result += source[index];
      index += 1;
      continue;
    }
    const inner = source.slice(index + nameLength, end - 1);
    result += `log(${inner},${log10 ? 10 : 2})`;
    index = end;
  }
  return result;
}

const FUNCTION_NAMES = new Set([
  'abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh',
  'cbrt', 'ceil', 'cos', 'cosh', 'cot', 'coth', 'csc', 'csch',
  'exp', 'expm1', 'fix', 'floor', 'gamma', 'hypot', 'log', 'log10',
  'log1p', 'log2', 'max', 'min', 'mod', 'nthRoot', 'pow', 'round',
  'sec', 'sech', 'sign', 'sin', 'sinh', 'sqrt', 'square', 'tan',
  'tanh', 'det', 'trace', 'transpose', 'sum',
]);
const CONSTANT_NAMES = new Set(['e', 'pi', 'i', 'Infinity', 'true', 'false', 'null']);

interface NodeLike {
  toString(): string;
  traverse(callback: (node: NodeLike, path: string, parent: NodeLike | null) => void): void;
  compile(): { evaluate(scope?: Record<string, number>): unknown };
  evaluate(scope?: Record<string, number>): unknown;
  type?: string;
  name?: string;
  isSymbolNode?: boolean;
}

function nodeOf(expression: string): NodeLike {
  return parse(expression) as unknown as NodeLike;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '∅';
  if (Math.abs(value) < EPSILON) return '0';
  const rounded = Math.round(value * 1e8) / 1e8;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value && typeof value === 'object' && 're' in value) {
    const complex = value as { re: number; im: number };
    return Math.abs(complex.im) < 1e-10 ? complex.re : null;
  }
  return null;
}

function simplifyExpression(expression: string): string {
  try {
    return simplify(expression).toString().replace(/\s+/g, '');
  } catch {
    return expression;
  }
}

/** Normalises display operators, LaTeX-like notation and implicit products. */
export function normalizeMathInput(input: string): string {
  let text = input
    .replace(/^\uFEFF/, '')
    .replace(/[−–—]/g, '-')
    .replace(/[×✕✖·]/g, '*')
    .replace(/[÷∕]/g, '/')
    .replace(/[，]/g, ',')
    .replace(/π/g, 'pi')
    .replace(/∞/g, 'Infinity')
    .replace(/√/g, 'sqrt')
    .replace(/Σ/g, 'sum')
    .replace(/\\left|\\right/g, '')
    .replace(/\\,|\\!|\\;/g, '')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\pi/g, 'pi')
    .replace(/\\ln/g, 'log')
    .replace(/\\log/g, 'log')
    .replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\bln\s*\(/g, 'log(')
    .replace(/\r?\n+/g, ';')
    .replace(/\s+/g, ' ')
    .trim();

  text = normalizeLogBases(text);

  // A little LaTeX-style summation notation: Σ_{n=1}^{10} n².
  text = text.replace(
    /sum\s*_?\{?\s*([a-zA-Z])\s*=\s*([^}\s^]+)\s*\}?\s*\^?\{?\s*([^}\s]+)\s*\}?\s*(.+)$/g,
    (_match, variable: string, lower: string, upper: string, body: string) =>
      `sum(${body},${variable}=${lower}..${upper})`,
  );

  // Keep explicit multiplication for the notation users see in textbooks.
  text = text.replace(/(\d|\))\s*(?=[a-zA-Z(])/g, '$1*');
  text = text.replace(/\s+/g, '');
  return text;
}

function variablesIn(expression: string): string[] {
  const names = new Set<string>();
  try {
    const node = nodeOf(expression);
    node.traverse((child, _path, parent) => {
      if (!child.isSymbolNode || !child.name) return;
      if (child.name === 'e' || child.name === 'pi' || child.name === 'i') return;
      if (parent?.type === 'FunctionNode' && parent.name === child.name) return;
      if (FUNCTION_NAMES.has(child.name) || CONSTANT_NAMES.has(child.name)) return;
      names.add(child.name);
    });
  } catch {
    // Invalid expressions are reported by the caller.
  }
  return [...names].sort();
}

function splitTopLevel(source: string, separator = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function equationSides(expression: string): [string, string] | null {
  const parts = expression.split('=');
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

function evaluateConstant(expression: string): number | null {
  try {
    return numeric(evaluate(expression));
  } catch {
    return null;
  }
}

function linearForm(difference: string, variables: readonly string[]): { constant: number; coefficients: number[] } | null {
  const scope = Object.fromEntries(variables.map((name) => [name, 0]));
  try {
    const constant = numeric(evaluate(difference, scope));
    if (constant === null) return null;
    const coefficients: number[] = [];
    for (const variable of variables) {
      const derivativeExpression = derivative(difference, variable).toString().replace(/\s+/g, '');
      if (variablesIn(derivativeExpression).some((name) => variables.includes(name))) return null;
      const coefficient = numeric(evaluate(derivativeExpression, scope));
      if (coefficient === null) return null;
      coefficients.push(coefficient);
    }
    return { constant, coefficients };
  } catch {
    return null;
  }
}

function solveLinearEquation(expression: string): MathSolution | null {
  const sides = equationSides(expression);
  if (!sides) return null;
  const difference = `(${sides[0]})-(${sides[1]})`;
  const variables = variablesIn(difference);
  if (!variables.length) {
    const left = evaluateConstant(sides[0]);
    const right = evaluateConstant(sides[1]);
    if (left === null || right === null) return null;
    const equal = Math.abs(left - right) < 1e-8;
    return {
      kind: equal ? 'true' : 'false',
      normalized: expression,
      result: `${formatNumber(left)} ${equal ? '=' : '≠'} ${formatNumber(right)}`,
      steps: [`${formatNumber(left)} ${equal ? '=' : '≠'} ${formatNumber(right)}`],
    };
  }
  if (variables.length > 1) return null;
  const form = linearForm(difference, variables);
  if (!form) return null;
  const variable = variables[0];
  const coefficient = form.coefficients[0];
  if (Math.abs(coefficient) < EPSILON) {
    return {
      kind: Math.abs(form.constant) < EPSILON ? 'identity' : 'none',
      normalized: expression,
      steps: [Math.abs(form.constant) < EPSILON ? 'The equation is true for every value.' : 'The equation has no solution.'],
    };
  }
  const answer = -form.constant / coefficient;
  return {
    kind: 'equation',
    normalized: expression,
    result: `${variable} = ${formatNumber(answer)}`,
    steps: [expression, `${variable} = ${formatNumber(answer)}`],
  };
}

function solveSystem(expression: string): MathSolution | null {
  const rows = expression.split(';').map((row) => row.trim()).filter(Boolean);
  if (rows.length < 2 || rows.some((row) => !equationSides(row))) return null;
  const differences = rows.map((row) => {
    const [left, right] = equationSides(row)!;
    return `(${left})-(${right})`;
  });
  const variables = [...new Set(differences.flatMap((difference) => variablesIn(difference)))];
  if (!variables.length || variables.length !== rows.length) {
    return {
      kind: 'unsupported',
      normalized: expression,
      steps: [],
      error: 'A system needs the same number of independent variables and equations.',
    };
  }
  const forms = differences.map((difference) => linearForm(difference, variables));
  if (forms.some((form) => !form)) {
    return {
      kind: 'unsupported',
      normalized: expression,
      steps: [],
      error: 'Systems of non-linear equations are not supported yet.',
    };
  }
  try {
    const matrix = forms.map((form) => form!.coefficients);
    const vector = forms.map((form) => -form!.constant);
    const solved = lusolve(matrix, vector) as unknown as number[][];
    const values = solved.map((row) => row[0]);
    if (values.some((value) => !Number.isFinite(value))) throw new Error('Singular system');
    const result = variables.map((variable, index) => `${variable} = ${formatNumber(values[index])}`).join(', ');
    return {
      kind: 'system',
      normalized: expression,
      result,
      steps: [...rows, result],
    };
  } catch {
    return {
      kind: 'unsupported',
      normalized: expression,
      steps: [],
      error: 'This system has no unique solution.',
    };
  }
}

function solveNumericEquation(expression: string): MathSolution | null {
  const sides = equationSides(expression);
  if (!sides) return null;
  const difference = `(${sides[0]})-(${sides[1]})`;
  const variables = variablesIn(difference);
  if (variables.length !== 1) return null;
  const variable = variables[0];
  try {
    const compiled = nodeOf(difference).compile();
    const f = (x: number): number | null => {
      try {
        return numeric(compiled.evaluate({ [variable]: x }));
      } catch {
        return null;
      }
    };
    const roots: number[] = [];
    let previousX: number | null = null;
    let previousY: number | null = null;
    const consider = (x: number, y: number | null): void => {
      if (y === null) return;
      if (Math.abs(y) < 1e-7) {
        if (!roots.some((root) => Math.abs(root - x) < 1e-4)) roots.push(x);
      }
      if (previousX !== null && previousY !== null && Math.sign(previousY) !== Math.sign(y)) {
        let low = previousX;
        let high = x;
        let lowValue = previousY;
        for (let iteration = 0; iteration < 48; iteration += 1) {
          const middle = (low + high) / 2;
          const middleValue = f(middle);
          if (middleValue === null) break;
          if (Math.abs(middleValue) < 1e-10) {
            low = middle;
            high = middle;
            lowValue = 0;
            break;
          }
          if (Math.sign(lowValue) === Math.sign(middleValue)) {
            low = middle;
            lowValue = middleValue;
          } else {
            high = middle;
          }
        }
        const root = (low + high) / 2;
        if (!roots.some((item) => Math.abs(item - root) < 1e-4)) roots.push(root);
      }
      previousX = x;
      previousY = y;
    };
    for (let x = -20; x <= 20.0001; x += 0.05) consider(x, f(x));
    previousX = null;
    previousY = null;
    for (let x = 0.001; x <= 100; x += 0.1) consider(x, f(x));
    if (!roots.length) {
      return { kind: 'none', normalized: expression, steps: ['No real solution was found in the scanned range.'] };
    }
    roots.sort((a, b) => a - b);
    const shown = roots.slice(0, MAX_ROOTS).map((root) => `${variable} ≈ ${formatNumber(root)}`);
    return {
      kind: 'equation',
      normalized: expression,
      result: shown.join(', '),
      steps: [expression, shown.join(', ')],
    };
  } catch {
    return null;
  }
}

function solveDerivative(expression: string): MathSolution | null {
  let variable = '';
  let body = '';
  const dMatch = expression.match(/^d\/d([a-zA-Z])\((.*)\)$/);
  const partialMatch = expression.match(/^∂\/∂([a-zA-Z])\((.*)\)$/);
  if (dMatch) [, variable, body] = dMatch;
  else if (partialMatch) [, variable, body] = partialMatch;
  else {
    const functionMatch = expression.match(/^(?:diff|derivative)\((.*)\)$/);
    if (!functionMatch) return null;
    const args = splitTopLevel(functionMatch[1]);
    if (args.length !== 2 || !/^[a-zA-Z]$/.test(args[1])) return null;
    [body, variable] = args;
  }
  if (!body || !variable) return null;
  try {
    const result = simplifyExpression(derivative(body, variable).toString());
    return {
      kind: 'derivative',
      normalized: expression,
      result: `d/d${variable} = ${result}`,
      steps: [`d/d${variable}(${body})`, `= ${result}`],
    };
  } catch {
    return {
      kind: 'unsupported',
      normalized: expression,
      steps: [],
      error: 'This derivative could not be calculated.',
    };
  }
}

function solveSum(expression: string): MathSolution | null {
  const match = expression.match(/^sum\((.*)\)$/);
  if (!match) return null;
  const args = splitTopLevel(match[1]);
  let body = '';
  let variable = '';
  let lower = '';
  let upper = '';
  if (args.length === 4) {
    [body, variable, lower, upper] = args;
  } else if (args.length === 2) {
    body = args[0];
    const range = args[1].match(/^([a-zA-Z])=(.+)\.\.(.+)$/);
    if (!range) return null;
    [, variable, lower, upper] = range;
  } else {
    return null;
  }
  if (!/^[a-zA-Z]$/.test(variable)) return null;
  const from = evaluateConstant(lower);
  const to = evaluateConstant(upper);
  if (from === null || to === null) return null;
  const start = Math.ceil(from);
  const end = Math.floor(to);
  if (end < start) {
    return { kind: 'sum', normalized: expression, result: '0', steps: [`Σ from ${start} to ${end} = 0`] };
  }
  if (end - start + 1 > MAX_SUM_TERMS) {
    return {
      kind: 'unsupported',
      normalized: expression,
      steps: [],
      error: `Sums are limited to ${MAX_SUM_TERMS.toLocaleString()} terms.`,
    };
  }
  try {
    const compiled = nodeOf(body).compile();
    let total = 0;
    for (let index = start; index <= end; index += 1) {
      const value = numeric(compiled.evaluate({ [variable]: index }));
      if (value === null) throw new Error('Non-numeric term');
      total += value;
    }
    const result = formatNumber(total);
    return {
      kind: 'sum',
      normalized: expression,
      result,
      steps: [`Σ ${body}, ${variable} = ${start}…${end}`, `= ${result}`],
    };
  } catch {
    return {
      kind: 'unsupported',
      normalized: expression,
      steps: [],
      error: 'This sum could not be evaluated numerically.',
    };
  }
}

function solveExpression(expression: string): MathSolution {
  const variables = variablesIn(expression);
  if (!variables.length) {
    try {
      const value = evaluate(expression);
      const number = numeric(value);
      if (number === null) throw new Error('The result is not a finite real number.');
      return {
        kind: 'value',
        normalized: expression,
        result: formatNumber(number),
        steps: [`${expression} = ${formatNumber(number)}`],
      };
    } catch {
      return {
        kind: 'unsupported',
        normalized: expression,
        steps: [],
        error: 'This expression could not be evaluated to a finite real number.',
      };
    }
  }
  const simplified = simplifyExpression(expression);
  return {
    kind: 'expression',
    normalized: expression,
    result: simplified,
    steps: [`${expression}`, `= ${simplified}`],
  };
}

export function solveMathInput(raw: string): MathSolution {
  const normalized = normalizeMathInput(raw);
  if (!normalized) return { kind: 'empty', normalized: '', steps: [] };
  if (!/[0-9a-zA-Z(]/.test(normalized)) {
    return { kind: 'unsupported', normalized, steps: [], error: 'No expression was found.' };
  }

  const derivative = solveDerivative(normalized);
  if (derivative) return derivative;
  const sum = solveSum(normalized);
  if (sum) return sum;
  if (normalized.includes(';')) {
    const system = solveSystem(normalized);
    if (system) return system;
  }
  if ((normalized.match(/=/g) ?? []).length > 1) {
    return {
      kind: 'unsupported',
      normalized,
      steps: [],
      error: 'Use semicolons between equations in a system.',
    };
  }
  if (normalized.includes('=')) {
    const linear = solveLinearEquation(normalized);
    if (linear) return linear;
    const numericSolution = solveNumericEquation(normalized);
    if (numericSolution) return numericSolution;
    return {
      kind: 'unsupported',
      normalized,
      steps: [],
      error: 'This equation could not be solved with the available methods.',
    };
  }
  return solveExpression(normalized);
}

/** Used by the vertical arithmetic viewer. */
export function evaluateArithmetic(expression: string): number | null {
  try {
    const normalized = normalizeMathInput(expression);
    const value = evaluate(normalized);
    return numeric(value);
  } catch {
    return null;
  }
}
