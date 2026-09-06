export function hasUnsafeRawPath(requestTarget: string): boolean {
  const rawPath = requestTarget.split("?", 1)[0] ?? "";
  try {
    const decoded = decodeURIComponent(rawPath);
    return (
      decoded.includes("\\") ||
      decoded.includes("\0") ||
      decoded.split("/").some((segment) => segment === "." || segment === "..")
    );
  } catch {
    return true;
  }
}
export function packagePath(pathname: string): string | undefined {
  try {
    const segments: readonly string[] = pathname
      .slice("/package/".length)
      .split("/")
      .map(decodeURIComponent);
    if (
      segments.some(
        (segment) => segment === "" || segment === "." || segment === ".." || /[\\/]/.test(segment),
      )
    )
      return undefined;
    return segments.join("/");
  } catch {
    return undefined;
  }
}
