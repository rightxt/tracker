/**
 * Parses the CLI contract shared by standalone benchmark profiles.
 *
 * @param {readonly string[]} argv - Arguments after the runner filename.
 * @param {{ booleanFlags?: readonly string[] }} [options] - Profile-specific boolean flags to accept.
 * @returns {{ flags: ReadonlySet<string>, output: string | null, phase: string, smoke: boolean }} Parsed options.
 */
function parseBenchmarkArguments(argv, { booleanFlags = [] } = {}) {
  const acceptedBooleanFlags = new Set(['--smoke', ...booleanFlags]);
  const flags = new Set();
  let output = null;
  let phase = 'unspecified';

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--') {
      continue;
    }

    if (acceptedBooleanFlags.has(argument)) {
      flags.add(argument);
      continue;
    }

    if (argument === '--output' || argument === '--phase') {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Benchmark argument "${argument}" requires a value.`);
      }

      if (argument === '--output') {
        output = value;
      } else {
        phase = value;
      }

      index += 1;
      continue;
    }

    if (argument.startsWith('--output=') || argument.startsWith('--phase=')) {
      const separatorIndex = argument.indexOf('=');
      const name = argument.slice(0, separatorIndex);
      const value = argument.slice(separatorIndex + 1);

      if (value === '') {
        throw new Error(`Benchmark argument "${name}" requires a value.`);
      }

      if (name === '--output') {
        output = value;
      } else {
        phase = value;
      }

      continue;
    }

    throw new Error(`Unknown benchmark argument "${argument}".`);
  }

  return {
    flags,
    output,
    phase,
    smoke: flags.has('--smoke'),
  };
}

export { parseBenchmarkArguments };
