// Calls a writer action with the default model and the art director's own
// system prompt (extension 0.37). A Convex deployment that predates those two
// fields refuses them as extra fields; then the call runs again without them,
// so the writer keeps working (on Haiku and the gallery's default prompt)
// until the backend is pushed. The Shots switch (`shots`) is dropped the same way.
export async function withWriterFallback<T extends { model?: unknown; rules?: unknown; shots?: unknown }, R>(
  input: T,
  run: (args: T) => Promise<R>,
): Promise<R> {
  try {
    return await run(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/extra field `?(rules|model|shots)`?/i.test(message) && !/`?(rules|model|shots)`? .*not in the validator/i.test(message)) throw error;
    const { model: _model, rules: _rules, shots: _shots, ...rest } = input;
    return run(rest as T);
  }
}
