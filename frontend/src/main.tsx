import React from 'react';
import ReactDOM from 'react-dom/client';
// Shared form, table and filter styles load before the pages' own, which refine them.
import './ui/form.css';
import './ui/table.css';
import './ui/filters.css';
import App from './App';
import './utils/axiosConfig'; // Initialize axios interceptors
import './i18n/config'; // Initialize i18n
import './index.css';
import './ui/banner.css';
import ErrorBoundary from './components/ErrorBoundary';
import reportWebVitals from './utils/reportWebVitals';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

reportWebVitals();
