// Pure TypeScript: unit-tested in Node.

/**
 * "+919876543210" -> "+91 98765 43210": how Indian numbers are usually written, and easy to
 * read back to a parent over the phone. Anything unexpected is shown as it came.
 */
export function formatIndianPhone(e164: string | null): string {
  if (!e164) {
    return '';
  }
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return match ? `+91 ${match[1]} ${match[2]}` : e164;
}
