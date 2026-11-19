import { describe, expect, it } from 'vitest';
import { evaluateArithmetic, normalizeMathInput, solveMathInput } from './solver';

describe('math solver', () => {
  it('evaluates arithmetic with precedence', () => {
    expect(evaluateArithmetic('2 + 3 × 4')).toBe(14);
    expect(evaluateArithmetic('(2 + 3) * 4')).toBe(20);
    expect(evaluateArithmetic('18 ÷ 3 - 1')).toBe(5);
  });

  it('normalises implicit multiplication', () => {
    expect(normalizeMathInput('2x + 3')).toBe('2*x+3');
    expect(normalizeMathInput('3(x−1)=6')).toBe('3*(x-1)=6');
    expect(normalizeMathInput('2 × 3')).toBe('2*3');
  });

  it('solves one-variable linear equations', () => {
    const solution = solveMathInput('2x + 3 = 7');
    expect(solution.kind).toBe('equation');
    expect(solution.result).toBe('x = 2');
    expect(solution.steps[0]).toBe('2*x+3=7');

    expect(solveMathInput('3(x-1)=6').result).toBe('x = 3');
    expect(solveMathInput('-x+4=1').result).toBe('x = 3');
    expect(solveMathInput('x/2+1=3').result).toBe('x = 4');
    expect(solveMathInput('2x+1=x+5').result).toBe('x = 4');
  });

  it('reports special equations', () => {
    expect(solveMathInput('x+1=x+1').kind).toBe('identity');
    expect(solveMathInput('x+1=x+2').kind).toBe('none');
    expect(solveMathInput('2+3=5').kind).toBe('true');
    expect(solveMathInput('2+3=6').kind).toBe('false');
    expect(solveMathInput('2+3=5').result).toBe('5 = 5');
  });

  it('returns values, numeric roots and errors for unsupported input', () => {
    expect(solveMathInput('23+45').result).toBe('68');
    expect(solveMathInput('x*x=9').kind).toBe('equation');
    expect(solveMathInput('x*x=9').result).toContain('x ≈');
    expect(solveMathInput('2x^2=8').result).toContain('x ≈');
    expect(solveMathInput('1/0').kind).toBe('unsupported');
    expect(solveMathInput('').kind).toBe('empty');
  });

  it('solves linear systems', () => {
    const system = solveMathInput('x + y = 5; x - y = 1');
    expect(system.kind).toBe('system');
    expect(system.result).toBe('x = 3, y = 2');
    expect(system.steps).toHaveLength(3);
  });

  it('differentiates, sums and evaluates advanced functions', () => {
    const derivative = solveMathInput('d/dx(x^3+2x)');
    expect(derivative.kind).toBe('derivative');
    expect(derivative.result).toContain('3*x^2+2');

    const sum = solveMathInput('sum(n^2, n=1..10)');
    expect(sum.kind).toBe('sum');
    expect(sum.result).toBe('385');

    const exponential = solveMathInput('2^x=8');
    expect(exponential.kind).toBe('equation');
    expect(exponential.result).toContain('x ≈ 3');

    const logarithm = solveMathInput('log(x)=2');
    expect(logarithm.kind).toBe('equation');
    expect(logarithm.result).toContain('x ≈ 7.389');

    expect(solveMathInput('log10(100)+exp(0)').result).toBe('3');
    expect(solveMathInput('x^2+2x+1').kind).toBe('expression');
  });

  it('handles decimal answers cleanly', () => {
    expect(solveMathInput('2x=5').result).toBe('x = 2.5');
    expect(solveMathInput('0.1+0.2').result).toBe('0.3');
  });
});
