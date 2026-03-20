import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import router from './router';
import { QCCountProvider } from './context/QCCountContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QCCountProvider>
      <RouterProvider router={router} />
    </QCCountProvider>
  </StrictMode>
);
