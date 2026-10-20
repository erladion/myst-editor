import katex from 'katex';

// Render TeX into `target`, showing the source in red if it doesn't parse.
export function renderMath(target: HTMLElement, tex: string, display: boolean) {
  try {
    katex.render(tex, target, { displayMode: display, throwOnError: false, strict: 'ignore' });
  } catch {
    target.textContent = tex;
    target.classList.add('math-error');
  }
}
