import { createBrowserRouter } from 'react-router-dom';
import App from './App';

// Lazy load pages
import Dashboard from './pages/Dashboard';
import Categories from './pages/Categories';
import Accounts from './pages/Accounts';
import Settings from './pages/Settings';
import Income from './pages/Income';
import Expenses from './pages/Expenses';
import Amazon from './pages/Amazon';
import Trends from './pages/Trends';
import ImportWizard from './pages/Import/ImportWizard';
import ReviewBatch from './pages/ReviewBatch';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'categories', element: <Categories /> },
      { path: 'accounts', element: <Accounts /> },
      { path: 'settings', element: <Settings /> },
      { path: 'income', element: <Income /> },
      { path: 'expenses', element: <Expenses /> },
      { path: 'amazon', element: <Amazon /> },
      { path: 'import', element: <ImportWizard /> },
      { path: 'import/:batchId/review', element: <ReviewBatch /> },
      { path: 'trends', element: <Trends /> },
    ],
  },
]);

export default router;
