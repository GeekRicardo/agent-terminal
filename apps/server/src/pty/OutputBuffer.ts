export class OutputBuffer {
  private buffer = '';
  private baseOffset = 0;
  private readonly cursors = new Map<string, number>();

  constructor(private readonly maxLength = 2_000_000) {}

  append(chunk: string): void {
    this.buffer += chunk;

    if (this.buffer.length <= this.maxLength) {
      return;
    }

    const overflow = this.buffer.length - this.maxLength;
    this.buffer = this.buffer.slice(overflow);
    this.baseOffset += overflow;

    for (const [cursorId, offset] of this.cursors) {
      if (offset < this.baseOffset) {
        this.cursors.set(cursorId, this.baseOffset);
      }
    }
  }

  snapshot(): string {
    return this.buffer;
  }

  read(cursorId: string): { rawOutput: string; fromOffset: number; toOffset: number } {
    const fromOffset = Math.max(this.cursors.get(cursorId) ?? this.baseOffset, this.baseOffset);
    const rawOutput = this.buffer.slice(fromOffset - this.baseOffset);
    const toOffset = this.baseOffset + this.buffer.length;

    this.cursors.set(cursorId, toOffset);

    return { rawOutput, fromOffset, toOffset };
  }
}
