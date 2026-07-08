import { describe, expect, it } from 'vitest';
import { cleanForAgent, foldCarriageReturns } from './output.js';

describe('foldCarriageReturns', () => {
  it('folds progress output on the same line', () => {
    expect(foldCarriageReturns('Downloading 1%\rDownloading 2%')).toBe('Downloading 2%');
  });

  it('keeps completed lines while folding the current line', () => {
    expect(foldCarriageReturns('one\ntwo\rthree')).toBe('one\nthree');
  });
});

describe('cleanForAgent', () => {
  it('removes ansi sequences and folds carriage returns', () => {
    expect(cleanForAgent('\u001B[32mBuild 1%\u001B[0m\r\u001B[32mBuild 2%\u001B[0m')).toBe('Build 2%');
  });
});
