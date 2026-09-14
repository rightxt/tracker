/**
 * Splits a whitespace-separated class string into class tokens.
 *
 * @param className - Class string candidate.
 * @returns Class tokens.
 */
function getClassTokens(className: unknown): string[] {
  if (typeof className !== 'string') {
    return [];
  }

  return [...new Set(className.split(/[ \t\n\f\r]+/u).filter(Boolean))];
}

/** Reserved service-class namespace pattern. */
const RESERVED_CLASS_TOKEN_PATTERN = /^rxtt(?:$|[-_])/u;

/**
 * Returns the first user class token that conflicts with the service namespace.
 *
 * @param className - User class string candidate.
 * @returns Reserved token or null.
 */
function getReservedClassToken(className: unknown): string | null {
  return getClassTokens(className).find((token) => RESERVED_CLASS_TOKEN_PATTERN.test(token)) ?? null;
}

/**
 * Normalizes a user class string using HTML ASCII whitespace semantics.
 *
 * @param className - User class string candidate.
 * @returns De-duplicated class string.
 */
function normalizeUserClassName(className: unknown): string {
  return getClassTokens(className).join(' ');
}

/**
 * Joins a required service class with optional user classes.
 *
 * @param serviceClassName - Required service class.
 * @param userClassName - User class candidate.
 * @returns Combined class name.
 */
function joinClassNames(serviceClassName: string, userClassName: unknown): string {
  return [serviceClassName, ...getClassTokens(userClassName)].join(' ');
}

export { getClassTokens, getReservedClassToken, joinClassNames, normalizeUserClassName };
