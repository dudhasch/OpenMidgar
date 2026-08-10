import { Route, Routes } from 'react-router-dom';
import AppShell from '@/components/shell/AppShell';
import Home from '@/pages/Home';
import DialogePage from '@/pages/Dialoge';
import QuestsPage from '@/pages/Quests';
import CharakterePage from '@/pages/Charaktere';
import FelderPage from '@/pages/Felder';
import PaketPage from '@/pages/Paket';
import GegnerPage from '@/pages/Gegner';
import SchlachtPage from '@/pages/Schlacht';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="dialoge" element={<DialogePage />} />
        <Route path="quests" element={<QuestsPage />} />
        <Route path="charaktere" element={<CharakterePage />} />
        <Route path="felder" element={<FelderPage />} />
        <Route path="gegner" element={<GegnerPage />} />
        <Route path="schlacht" element={<SchlachtPage />} />
        <Route path="paket" element={<PaketPage />} />
      </Route>
    </Routes>
  );
}
