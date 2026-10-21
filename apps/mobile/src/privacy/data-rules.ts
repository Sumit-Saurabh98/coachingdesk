// Pure TypeScript: the "Your data" screen's rules, unit-tested in Node.

export type ExportStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired';

export interface DataExport {
  id: string;
  status: ExportStatus;
  byteSize: number | null;
  createdAt: string;
  readyAt: string | null;
  expiresAt: string | null;
  downloadPath: string | null; // on the API (owner login needed), set when ready
}

/** Still being made: keep asking the server until it's done. */
export function isWorking(status: ExportStatus): boolean {
  return status === 'queued' || status === 'running';
}

/** "coachingdesk-export-2026-10-22.zip": the date it was asked for. */
export function exportFileName(createdAt: string): string {
  return `coachingdesk-export-${createdAt.slice(0, 10)}.zip`;
}

/** 1536 -> "1.5 KB", 2_500_000 -> "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Number(kb.toFixed(1))} KB`;
  }
  return `${Number((kb / 1024).toFixed(1))} MB`;
}

/** The SMS code for deleting the institute: 6 digits, like the login code. */
export function isOtp(text: string): boolean {
  return /^\d{6}$/.test(text.trim());
}
