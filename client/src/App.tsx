import { ConnectionBanner, Toasts } from './components/Chrome';
import { Showcase } from './demo/Showcase';
import { FxStage } from './fx/FxStage';
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

/** `?showcase` opens the effects preview, which needs no server. */
const SHOWCASE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('showcase');

export default function App() {
  return (
    <I18nProvider>
      <FxStage />
      {SHOWCASE ? (
        <Showcase />
      ) : (
        <GameProvider>
          <ConnectionBanner />
          <Toasts />
          <Screens />
        </GameProvider>
      )}
    </I18nProvider>
  );
}
