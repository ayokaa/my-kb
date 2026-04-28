import { execFile } from 'child_process';

export function runCamoufox(
  cmd: string,
  args: string[],
  opts: { timeout?: number; encoding?: BufferEncoding },
  callback: (error: Error | null, stdout: string, stderr: string) => void
): void {
  execFile(cmd, args, opts, callback);
}
