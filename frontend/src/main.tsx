import React from 'react';
import ReactDOM from 'react-dom/client';
// The tokens and the design system's shared styles load before the pages' own, which refine them.
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/onest';
import './features/shell/tokens.css';
import './index.css';
import './ui/motion.css';
import './ui/base.css';
import './ui/button.css';
import './ui/card.css';
import './ui/banner.css';
import './ui/form.css';
import './ui/table.css';
import './ui/filters.css';
import App from './App';
import './i18n/config'; // Initialize i18n
import ErrorBoundary from './components/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
