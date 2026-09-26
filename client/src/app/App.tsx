import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { sounds } from '../lib/sound';
import { useToast } from './ToastProvider';
import { useSession } from './SessionProvider';
import { LandingPage } from '../pages/LandingPage';
import { JoinPage } from '../pages/JoinPage';
import { RoomPage } from '../pages/RoomPage';
import { NotFoundPage } from '../pages/NotFoundPage';

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useSession();

  // Audio requires a user gesture; unlock on first interaction.
  useEffect(() => {
    const unlock = () => sounds.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // TikTok OAuth redirects back with ?tiktok=connected
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tiktok') === 'connected') {
      toast.success('TikTok connected.');
      void refresh();
      navigate(location.pathname, { replace: true });
    }
  }, [location.search, location.pathname, navigate, toast, refresh]);

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="/join/:code" element={<JoinPage />} />
      <Route path="/room/:code" element={<RoomPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
