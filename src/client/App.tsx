import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { setOnUnauthorized } from './api/client.ts';
import { useMe } from './api/queries.ts';
import AppShell from './components/AppShell.tsx';
import { ToastProvider } from './components/Toast.tsx';
import LoginPage from './pages/LoginPage.tsx';
import ProductPage from './pages/ProductPage.tsx';
import ProductsPage from './pages/ProductsPage.tsx';
import ReceiptPage from './pages/ReceiptPage.tsx';
import ReceiptsPage from './pages/ReceiptsPage.tsx';
import ScanPage from './pages/ScanPage.tsx';
import ShoppingListDetailPage from './pages/ShoppingListDetailPage.tsx';
import ShoppingListPage from './pages/ShoppingListPage.tsx';

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
          <Route path="shopping-lists/:id" element={<ShoppingListDetailPage />} />
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
