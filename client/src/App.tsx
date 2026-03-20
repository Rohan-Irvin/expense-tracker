import { Outlet, NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Tags, Wallet, Upload, DollarSign,
  Receipt, Settings, ShoppingCart, BookOpen, TrendingUp, ShieldAlert
} from 'lucide-react';
import { useQCCount } from '@/context/QCCountContext';

export default function App() {
  const { count: qcCount } = useQCCount();

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Cashflow' },
    { to: '/categories', icon: Tags, label: 'Categories' },
    { to: '/accounts', icon: Wallet, label: 'Accounts' },
    { to: '/import', icon: Upload, label: 'Import' },
    { to: '/expenses', icon: Receipt, label: 'Expenses' },
    { to: '/income', icon: DollarSign, label: 'Income' },
    { to: '/trends', icon: TrendingUp, label: 'Trends' },
    { to: '/amazon', icon: ShoppingCart, label: 'Amazon' },
    { to: '/qc', icon: ShieldAlert, label: 'QC', badge: qcCount > 0 ? qcCount : undefined },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-sidebar-background flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-bold text-sidebar-foreground flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            Expense Tracker
          </h1>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(({ to, icon: Icon, label, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              <span className="flex-1">{label}</span>
              {badge !== undefined && (
                <span className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-xs font-bold rounded-full bg-red-500 text-white">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
