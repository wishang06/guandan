import { ConnectionBanner, Toasts } from './components/Chrome';
import { I18nProvider } from './i18n';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Table } from './screens/Table';
import { GameProvider, useGame } from './state/game';

function Screens() {
  const { view, session } = useGame();
  if (!session || !view) return <Home />;
  if (view.status === 'playing' && view.game) return <Table view={view} />;
  return <Lobby view={view} />;
}

export default function App() {
  return (
    <I18nProvider>
      <GameProvider>
        <ConnectionBanner />
        <Toasts />
        <Screens />
      </GameProvider>
    </I18nProvider>
  );
}
