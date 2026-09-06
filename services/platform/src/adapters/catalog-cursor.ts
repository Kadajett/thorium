export function encodeCatalogCursor(packageId: string): string {
  return Buffer.from(packageId, "utf8").toString("base64url");
}

export function decodeCatalogCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (decoded.length === 0 || encodeCatalogCursor(decoded) !== cursor)
    throw new Error("invalid_catalog_cursor");
  return decoded;
}
