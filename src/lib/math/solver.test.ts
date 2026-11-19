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

  it('returns values for arithmetic and errors for unsupported input', () => {
    expect(solveMathInput('23+45').result).toBe('68');
    expect(solveMathInput('x*x=9').kind).toBe('unsupported');
    expect(solveMathInput('1/0').kind).toBe('unsupported');
    expect(solveMathInput('2x^2=8').kind).toBe('unsupported');
    expect(solveMathInput('').kind).toBe('empty');
  });

  it('handles decimal answers cleanly', () => {
    expect(solveMathInput('2x=5').result).toBe('x = 2.5');
    expect(solveMathInput('0.1+0.2').result).toBe('0.3');
  });
});
