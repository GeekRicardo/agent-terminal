import { describe, expect, it } from 'vitest';
import { OutputBuffer } from './OutputBuffer.js';

describe('OutputBuffer cursor reads', () => {
  it('advances each cursor independently', () => {
    const buffer = new OutputBuffer();

    buffer.append('hello');

    expect(buffer.read('a').rawOutput).toBe('hello');
    expect(buffer.read('a').rawOutput).toBe('');
    expect(buffer.read('b').rawOutput).toBe('hello');

    buffer.append(' world');
    expect(buffer.read('a').rawOutput).toBe(' world');
    expect(buffer.read('b').rawOutput).toBe(' world');
  });
});
