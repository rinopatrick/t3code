export function parseDshVersion(output: string): string | null {
  return output.match(/\b\d+\.\d+\.\d+(?:-rc\.\d+)?\b/)?.[0] ?? null;
}
