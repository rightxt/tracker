import { performCompilation, readConfiguration } from '@angular/compiler-cli';
import ts from 'typescript';

/** Angular tsconfig supplied by the build orchestrator, with the package build config as the standalone default. */
const PROJECT_PATH = process.argv[2] ?? 'packages/angular/tsconfig.build.json';

/** Angular compiler configuration and initial diagnostics. */
const configuration = readConfiguration(PROJECT_PATH);

/** Partial-compilation result. */
const compilation = performCompilation({
  rootNames: configuration.rootNames,
  options: configuration.options,
});

/** Complete Angular and TypeScript diagnostics. */
const diagnostics = [...configuration.errors, ...compilation.diagnostics];

if (diagnostics.length > 0) {
  process.stderr.write(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
}

if (diagnostics.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
  process.exitCode = 1;
}
