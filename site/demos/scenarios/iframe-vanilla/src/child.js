import '@rightxt/tracker-vanilla/style.css';
import './child.css';

/** Demo-owned generation displayed by the current child document. */
const generation = Number(new URL(window.location.href).searchParams.get('generation'));

/** Child-owned output that identifies the current fixture generation. */
const generationOutput = document.querySelector('#child-generation');

if (!(generationOutput instanceof HTMLOutputElement) || !Number.isInteger(generation) || generation < 1) {
  throw new Error('Iframe child generation is invalid.');
}

generationOutput.value = String(generation);
document.body.dataset.generation = String(generation);
document.title = `Child document #${String(generation)}`;
