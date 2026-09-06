import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { setOnUnauthorized } from './api/client.ts';
import { useMe } from './api/queries.ts';
import AppShell from './components/AppShell.tsx';
import { ToastProvider } from './components/Toast.tsx';
import LoginPage from './pages/LoginPage.tsx';

// Placeholders until their own tasks (T15-T19) replace them with the real pages.
function ShoppingListPage() {
  return <h1 className="p-4 text-xl font-bold">Handleliste</h1>;
}
function ScanPage() {
  return <h1 className="p-4 text-xl font-bold">Skann</h1>;
}
function ReceiptsPage() {
  return <h1 className="p-4 text-xl font-bold">Kvitteringer</h1>;
}
function ReceiptPage() {
  return <h1 className="p-4 text-xl font-bold">Kvittering</h1>;
}
function ProductsPage() {
  return <h1 className="p-4 text-xl font-bold">Varer</h1>;
}
function ProductPage() {
  return <h1 className="p-4 text-xl font-bold">Vare</h1>;
}

function UnauthorizedBridge(): null {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    setOnUnauthorized(() => {
      queryClient.clear();
      navigate('/login');
    });
    return () => setOnUnauthorized(null);
  }, [navigate, queryClient]);

  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending, isError } = useMe();

  if (isPending) {
    return <p>Laster …</p>;
  }

  if (isError || !data?.authenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  return (
    <ToastProvider>
      <UnauthorizedBridge />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<ShoppingListPage />} />
          <Route path="scan" element={<ScanPage />} />
          <Route path="receipts" element={<ReceiptsPage />} />
          <Route path="receipts/:id" element={<ReceiptPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="products/:id" element={<ProductPage />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
