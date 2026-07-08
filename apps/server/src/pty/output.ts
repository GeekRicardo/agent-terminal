const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

export function cleanForAgent(input: string): string {
  return foldCarriageReturns(input.replace(ANSI_PATTERN, '')).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

export function foldCarriageReturns(input: string): string {
  const lines: string[] = [''];
  let column = 0;

  for (const char of input) {
    if (char === '\r') {
      column = 0;
      continue;
    }

    if (char === '\n') {
      lines.push('');
      column = 0;
      continue;
    }

    const current = lines[lines.length - 1] ?? '';
    lines[lines.length - 1] = replaceAt(current, column, char);
    column += 1;
  }

  return lines.join('\n');
}

function replaceAt(value: string, index: number, char: string): string {
  if (index >= value.length) {
    return value.padEnd(index, ' ') + char;
  }

  return value.slice(0, index) + char + value.slice(index + 1);
}
