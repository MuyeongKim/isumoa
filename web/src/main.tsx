import 'wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.css';
// 직인 안의 글자에만 쓴다
import '@fontsource/noto-serif-kr/600.css';
import './index.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Toaster } from 'sonner';
import { AppShell } from './components/AppShell';
import { AdminOnly, RequireAuth } from './components/RequireAuth';
import { ApiError } from './lib/api';
import { EmployeeImportPage } from './pages/EmployeeImportPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { ExportPage } from './pages/ExportPage';
import { FormsPage } from './pages/FormsPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { ReviewPage } from './pages/review/ReviewPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { SetupPage } from './pages/SetupPage';
import { StatusPage } from './pages/StatusPage';
import { TrainingsPage } from './pages/TrainingsPage';
import { UploadPage } from './pages/UploadPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // 로그인·권한 오류는 다시 시도해도 같으므로 바로 알린다
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-[22px] font-bold tracking-[-0.03em]">찾는 화면이 없습니다</p>
      <Link to="/" className="mt-3 inline-block text-link hover:underline">
        대시보드로 가기
      </Link>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'upload', element: <UploadPage /> },
      // wide: 화면 폭을 넓게 쓰는 페이지
      { path: 'review', element: <ReviewPage />, handle: { wide: true } },
      { path: 'status', element: <StatusPage />, handle: { wide: true } },
      { path: 'export', element: <ExportPage /> },
      { path: 'export/forms', element: <FormsPage /> },
      { path: 'employees', element: <EmployeesPage /> },
      {
        path: 'employees/import',
        element: (
          <AdminOnly>
            <EmployeeImportPage />
          </AdminOnly>
        ),
      },
      { path: 'trainings', element: <TrainingsPage /> },
      {
        path: 'settings',
        element: (
          <AdminOnly>
            <SettingsPage />
          </AdminOnly>
        ),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors closeButton toastOptions={{ style: { fontFamily: 'inherit' } }} />
    </QueryClientProvider>
  </StrictMode>,
);
