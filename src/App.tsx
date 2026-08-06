import { AdminPage } from './pages/AdminPage';
import { WallPage } from './pages/WallPage';

export default function App() {
  return location.pathname.startsWith('/wall') ? <WallPage /> : <AdminPage />;
}
