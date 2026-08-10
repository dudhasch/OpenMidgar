import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AppStateProvider } from '@/lib/app-state'
import { UiModusProvider } from '@/lib/ui-modus'
import { Toaster } from '@/components/ui/sonner'

createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <AppStateProvider>
      <UiModusProvider>
        <App />
        <Toaster position="bottom-right" richColors={false} />
      </UiModusProvider>
    </AppStateProvider>
  </HashRouter>,
)
