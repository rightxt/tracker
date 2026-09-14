/**
 * Flattens a nested configuration schema into dot-separated leaf paths.
 *
 * @param shape - Nested options or rule schema.
 * @param prefix - Internal path prefix.
 * @returns Every leaf path declared in the schema.
 */
function collectSchemaLeafPaths(shape: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(shape).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    return value !== null && typeof value === 'object'
      ? collectSchemaLeafPaths(value as Record<string, unknown>, path)
      : [path];
  });
}

export { collectSchemaLeafPaths };
