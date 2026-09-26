import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { ThemeProvider } from './app/ThemeProvider';
import { SessionProvider } from './app/SessionProvider';
import { ToastProvider } from './app/ToastProvider';
import './styles/tokens.css';
import './styles/components.css';
import './styles/screens.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <SessionProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SessionProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
