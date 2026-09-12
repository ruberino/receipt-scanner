import { NavLink, Outlet } from 'react-router';

const tabs = [
  { to: '/', label: 'Handleliste', end: true },
  { to: '/scan', label: 'Skann', end: false },
  { to: '/receipts', label: 'Kvitteringer', end: false },
  { to: '/products', label: 'Varer', end: false },
];

export default function AppShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 flex border-t border-ink/10 bg-paper pb-[env(safe-area-inset-bottom)]">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex min-h-12 flex-1 items-center justify-center ${
                isActive ? 'font-semibold text-accent' : 'text-ink-muted'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
