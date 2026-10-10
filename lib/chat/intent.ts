/**
 * Output-format intent read from the user's own words (Indonesian + English).
 * Used on the server to add explicit directives to the prompt and in the UI to emphasise the
 * deliverable the user asked for (ZIP, changed files only). It never forces file output.
 */
export interface Intent {
  zip: boolean;
  changedOnly: boolean;
}

const ZIP = /\bzip\b|\.zip\b|\barsip\b/i;
const CHANGED_ONLY = [
  /(hanya|cuma|saja|only|just)\W+(?:\w+\W+){0,6}?(berubah|diubah|di-?edit|diedit|changed|modified|edited|updated)/i,
  /(berubah|diubah|changed|modified)\W+(?:\w+\W+){0,3}?(saja|only)/i,
  /changed[- ]files?|file\s+(yang\s+)?(berubah|diubah)|file[- ]file\s+(yang\s+)?(berubah|diubah)/i,
];

export function detectIntent(text: string): Intent {
  return { zip: ZIP.test(text), changedOnly: CHANGED_ONLY.some((re) => re.test(text)) };
}
