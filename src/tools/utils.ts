/**
 * If the path has no file extension, append ".html".
 * Paths already ending in any extension (.html, .md, .json, .png, …) are left unchanged.
 */
export function ensureHtmlExtension(path: string): string {
  if (!path) return path;
  const last = path.split("/").pop() ?? "";
  return last.includes(".") ? path : `${path}.html`;
}
