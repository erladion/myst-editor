import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles.css';
import { App } from './App';

// Light or dark, as the main process says (View → Appearance, or the system's).
const setDark = (dark: boolean) => (document.documentElement.dataset.theme = dark ? 'dark' : 'light');
window.myst.onDarkChanged(setDark);
void window.myst.isDark().then(setDark);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
