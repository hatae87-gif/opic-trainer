import { useEffect, useState } from 'react'
import { requestPersistence } from './db/db'
import { HomeScreen } from './screens/HomeScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { ScriptScreen } from './screens/ScriptScreen'

type Route = { name: 'home' } | { name: 'script'; id: string } | { name: 'review' }

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' })

  useEffect(() => {
    void requestPersistence()
  }, [])

  // 안드로이드 뒤로가기 버튼이 앱을 닫지 않고 홈으로 돌아오게 한다
  useEffect(() => {
    if (route.name !== 'home') history.pushState({ route: route.name }, '')
    const onPop = () => setRoute({ name: 'home' })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [route])

  const goHome = () => {
    if (history.state?.route) history.back()
    else setRoute({ name: 'home' })
  }

  switch (route.name) {
    case 'script':
      return <ScriptScreen scriptId={route.id} onBack={goHome} />
    case 'review':
      return <ReviewScreen onDone={goHome} />
    default:
      return (
        <HomeScreen
          onOpenScript={(id) => setRoute({ name: 'script', id })}
          onStartReview={() => setRoute({ name: 'review' })}
        />
      )
  }
}
