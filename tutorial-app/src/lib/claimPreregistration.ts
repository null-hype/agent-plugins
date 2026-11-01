export type WitnessFinding = {
  id: string;
  location: { file: string; line: number; column: number };
  severity: 'error' | 'warning' | 'information' | 'hint';
  message: string;
  sourceHash?: string;
  evidence?: string[];
};
export type ClaimPreregistration = {
  file: string;
  source: string;
  // The versioned findings.json emitted by the check, unchanged.
  findings?: { version: number; findings: WitnessFinding[] } | null;
};
export type ClaimDiagnostic = { line: number; column: number; severity: string; message: string; evidence: string[] };
export type PreregistrationProjection = { lines: string[]; diagnostics: ClaimDiagnostic[]; notice: string };

export async function projectPreregistration(artifact: ClaimPreregistration): Promise<PreregistrationProjection> {
  const lines = artifact.source.split('\n');
  const diagnostics: ClaimDiagnostic[] = [];
  if (!artifact.findings) return { lines, diagnostics, notice: 'Findings unavailable for this rerun.' };
  if (artifact.findings.version !== 1) return { lines, diagnostics, notice: 'Unsupported findings format. Diagnostics unavailable.' };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(artifact.source));
  const hash = 'sha256:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  let omitted = 0;
  for (const finding of artifact.findings.findings ?? []) {
    const { file, line, column } = finding.location;
    const matches = file === artifact.file || file.endsWith('/' + artifact.file);
    // Never relocate findings from test files onto predictions, or clamp bad lines.
    if (!matches || !Number.isInteger(line) || line < 1 || line > lines.length || !Number.isInteger(column) || column < 1 || column > lines[line - 1].replace(/\r$/, '').length + 1) { omitted++; continue; }
    diagnostics.push({ line, column, severity: finding.severity, message: (finding.sourceHash && finding.sourceHash !== hash ? 'stale finding (verified against other source): ' : '') + finding.message, evidence: finding.evidence ?? [] });
  }
  const notice = omitted ? `${omitted} finding(s) refer to another file or an invalid location; not placed on this document.` : diagnostics.length ? `${diagnostics.length} finding(s) from this check.` : 'No findings on this preregistration.';
  return { lines, diagnostics, notice };
}
