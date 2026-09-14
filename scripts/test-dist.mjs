import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Package directory with workspace-linked Core resolution. */
const CORE_CONSUMER_DIR = fileURLToPath(new URL('../packages/react/', import.meta.url));

/**
 * Creates a minimal `CustomElementRegistry` that rejects duplicate definitions like the browser API.
 */
function createCustomElementsRegistry() {
  const registry = new Map();

  return {
    define(name, constructor) {
      if (registry.has(name)) {
        throw new Error(
          `Failed to execute 'define' on 'CustomElementRegistry': the name "${name}" has already been used with this registry`,
        );
      }

      registry.set(name, constructor);
    },
    get(name) {
      return registry.get(name);
    },
  };
}

/** Resolves a package specifier in a fresh Node process under one package condition. */
function resolvePackageSpecifier(specifier, condition) {
  const args = condition === undefined ? [] : [`--conditions=${condition}`];
  args.push('--input-type=module', '--eval', `process.stdout.write(import.meta.resolve('${specifier}'))`);

  return execFileSync(process.execPath, args, {
    cwd: CORE_CONSUMER_DIR,
    encoding: 'utf8',
  });
}

/**
 * Runs an ESM script in a fresh Node process under one package export condition.
 *
 * Separate processes keep production and debug module caches isolated.
 */
function runNodeEvalScript(scriptSource, condition) {
  const args = condition === undefined ? [] : [`--conditions=${condition}`];
  args.push('--input-type=module', '--eval', scriptSource);

  return execFileSync(process.execPath, args, {
    cwd: CORE_CONSUMER_DIR,
    encoding: 'utf8',
  });
}

for (const subpath of ['', '/projection', '/renderer', '/advanced']) {
  const specifier = `@rightxt/tracker-core${subpath}`;

  assert.match(resolvePackageSpecifier(specifier, 'development'), /debug\.mjs$/u);
  assert.doesNotMatch(resolvePackageSpecifier(specifier, 'production'), /debug\.mjs$/u);
  assert.doesNotMatch(resolvePackageSpecifier(specifier, undefined), /debug\.mjs$/u);
}

// Verify debug tracing through both renderer and projection facades.
// Each scenario runs in a fresh Node process so package conditions and module caches are isolated.
// Both facades are tested independently because shared Rollup chunks are an implementation detail.
// Changing orientation guarantees a real configuration update without depending on trace event names.
// The integration does not need to be mounted because configuration replacement is synchronous.
const RENDERER_DEBUG_TRACE_SCRIPT = `
import { getTrackerDebugTrace } from '@rightxt/tracker-core/advanced';
import { createTrackerRendererIntegration } from '@rightxt/tracker-core/renderer';

const integration = createTrackerRendererIntegration({ options: { orientation: 'vertical' } }, { renderer: {} });
const before = getTrackerDebugTrace(integration);

if (!Array.isArray(before)) {
  throw new Error('Expected an array debug trace from the debug build.');
}

integration.replaceOptions({ orientation: 'horizontal' });
const after = getTrackerDebugTrace(integration);

if (!Array.isArray(after) || after.length <= before.length) {
  throw new Error('Expected the debug trace to grow after a non-no-op options replacement.');
}
process.stdout.write('ok');
`;
const RENDERER_PRODUCTION_TRACE_SCRIPT = `
import { getTrackerDebugTrace } from '@rightxt/tracker-core/advanced';
import { createTrackerRendererIntegration } from '@rightxt/tracker-core/renderer';

const integration = createTrackerRendererIntegration({ options: { orientation: 'vertical' } }, { renderer: {} });
integration.replaceOptions({ orientation: 'horizontal' });
const trace = getTrackerDebugTrace(integration);

if (trace !== null) {
  throw new Error('Expected a null debug trace from the production build.');
}
process.stdout.write('ok');
`;
const PROJECTION_DEBUG_TRACE_SCRIPT = `
import { getTrackerDebugTrace } from '@rightxt/tracker-core/advanced';
import { createTrackerProjectionIntegration } from '@rightxt/tracker-core/projection';

const integration = createTrackerProjectionIntegration({ options: { orientation: 'vertical' } });
const before = getTrackerDebugTrace(integration);

if (!Array.isArray(before)) {
  throw new Error('Expected an array debug trace from the debug build.');
}

integration.replaceConfiguration({ options: { orientation: 'horizontal' }, rules: [] });
const after = getTrackerDebugTrace(integration);

if (!Array.isArray(after) || after.length <= before.length) {
  throw new Error('Expected the debug trace to grow after a non-no-op configuration replacement.');
}
process.stdout.write('ok');
`;

assert.equal(runNodeEvalScript(RENDERER_DEBUG_TRACE_SCRIPT, 'development').trim(), 'ok');
assert.equal(runNodeEvalScript(RENDERER_PRODUCTION_TRACE_SCRIPT, 'production').trim(), 'ok');
assert.equal(runNodeEvalScript(PROJECTION_DEBUG_TRACE_SCRIPT, 'development').trim(), 'ok');

const vanillaModule = await import('../packages/vanilla/dist/rxt-tracker-vanilla.mjs');
assert.equal(typeof vanillaModule.default, 'function');
assert.equal(vanillaModule.default, vanillaModule.Tracker);

const elementModule = await import('../packages/element/dist/rxt-tracker-element.mjs');
assert.equal(typeof elementModule.default, 'function');
assert.equal(elementModule.default, elementModule.TrackerElement);
assert.equal(typeof elementModule.defineTrackerElement, 'function');

const reactModule = await import('../packages/react/dist/rxt-tracker-react.mjs');
assert.equal(typeof reactModule.default, 'function');
assert.equal(reactModule.default, reactModule.Tracker);

const vueModule = await import('../packages/vue/dist/rxt-tracker-vue.mjs');
assert.equal(typeof vueModule.default, 'object');
assert.equal(vueModule.default, vueModule.Tracker);

await import('@angular/compiler');
const angularModule = await import('../packages/angular/dist/rxt-tracker-angular.mjs');
assert.equal(typeof angularModule.TrackerComponent, 'function');

const elementModuleRegistry = createCustomElementsRegistry();
const originalCustomElementsBeforeRegisterImport = globalThis.customElements;

try {
  globalThis.customElements = elementModuleRegistry;
  await import('../packages/element/dist/register.mjs');
  assert.equal(elementModuleRegistry.get('rxt-tracker'), elementModule.TrackerElement);
} finally {
  if (originalCustomElementsBeforeRegisterImport === undefined) {
    delete globalThis.customElements;
  } else {
    globalThis.customElements = originalCustomElementsBeforeRegisterImport;
  }
}

// Exercise the three `defineTrackerElement()` guard branches against the built module.
// The check needs only `customElements.get()`/`define()`, so a browser is unnecessary.
{
  const originalCustomElements = globalThis.customElements;

  delete globalThis.customElements;

  try {
    assert.equal(elementModule.defineTrackerElement(), null);
  } finally {
    if (originalCustomElements === undefined) {
      delete globalThis.customElements;
    } else {
      globalThis.customElements = originalCustomElements;
    }
  }
}

{
  const registry = createCustomElementsRegistry();
  const originalCustomElements = globalThis.customElements;

  globalThis.customElements = registry;

  try {
    assert.equal(elementModule.defineTrackerElement(), elementModule.TrackerElement);
    // A repeat call must not redefine an occupied custom-element name.
    assert.equal(elementModule.defineTrackerElement(), elementModule.TrackerElement);
  } finally {
    if (originalCustomElements === undefined) {
      delete globalThis.customElements;
    } else {
      globalThis.customElements = originalCustomElements;
    }
  }
}

{
  const registry = createCustomElementsRegistry();

  class OtherTrackerElementConstructor {}

  registry.define('rxt-tracker', OtherTrackerElementConstructor);

  const originalCustomElements = globalThis.customElements;

  globalThis.customElements = registry;

  try {
    assert.throws(() => elementModule.defineTrackerElement());
  } finally {
    if (originalCustomElements === undefined) {
      delete globalThis.customElements;
    } else {
      globalThis.customElements = originalCustomElements;
    }
  }
}

process.stdout.write('Built Node ESM resolution and runtime import contracts passed.\n');
