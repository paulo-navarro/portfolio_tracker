import { Shell } from './components/Shell.tsx'
import { ErrorBox, Notice, Spinner } from './components/ui.tsx'
import { useOnline } from './lib/offline.ts'
import { useMe } from './lib/queries.ts'
import { match, usePath } from './lib/router.tsx'
import { Accounts } from './screens/Accounts.tsx'
import { Home } from './screens/Home.tsx'
import { Login } from './screens/Login.tsx'
import { Portfolio } from './screens/Portfolio.tsx'
import { Settings } from './screens/Settings.tsx'

export function App() {
  const me = useMe()
  const online = useOnline()
  const route = match(usePath())

  // Offline e sem nada guardado: não dá para saber nem quem está logado.
  if (!online && me.data === undefined) {
    return (
      <div className="splash">
        <Notice tone="warn" icon="⚡">
          Sem conexão, e ainda não há nada guardado neste aparelho. Abra uma vez com internet.
        </Notice>
      </div>
    )
  }

  if (me.isPending) {
    return (
      <div className="splash">
        <Spinner />
      </div>
    )
  }
  if (me.error) {
    return (
      <div className="splash">
        <ErrorBox error={me.error} retry={() => void me.refetch()} />
      </div>
    )
  }
  if (!me.data) return <Login />

  switch (route.name) {
    case 'home':
      return <Home />
    case 'portfolio':
      return <Portfolio key={route.id} id={route.id} />
    case 'accounts':
      return <Accounts key={route.id} id={route.id} />
    case 'settings':
      return <Settings />
    default:
      return (
        <Shell back={{ to: '/', label: 'Início' }}>
          <Notice icon="?">Página não encontrada.</Notice>
        </Shell>
      )
  }
}
