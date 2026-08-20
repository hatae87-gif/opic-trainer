import { useEffect, useState } from 'react'
import { requestPersistence } from './db/db'
import { ExamScreen } from './screens/ExamScreen'
import { HomeScreen } from './screens/HomeScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { ScriptScreen } from './screens/ScriptScreen'
import { SpeakingScreen } from './screens/SpeakingScreen'
import { StatsScreen } from './screens/StatsScreen'

type Tab = 'home' | 'speaking' | 'exam' | 'stats'
type Route =
  | { name: 'home' }
  | { name: 'script'; id: string }
  | { name: 'review' }
  | { name: 'speaking' }
  | { name: 'exam' }
  | { name: 'stats' }

const TABS: { tab: Tab; icon: string; label: string }[] = [
  { tab: 'home', icon: '📚', label: '스크립트' },
  { tab: 'speaking', icon: '🎤', label: '스피킹' },
  { tab: 'exam', icon: '📝', label: '모의고사' },
  { tab: 'stats', icon: '📊', label: '기록' },
]

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

  /** 탭이 보이는 최상위 화면인지. 스크립트 상세·복습은 전체 화면을 쓴다 */
  const activeTab: Tab | null =
    route.name === 'home' || route.name === 'speaking' || route.name === 'exam' || route.name === 'stats'
      ? route.name
      : null

  const screen = (() => {
    switch (route.name) {
      case 'script':
        return <ScriptScreen scriptId={route.id} onBack={goHome} />
      case 'review':
        return <ReviewScreen onDone={goHome} />
      case 'speaking':
        return <SpeakingScreen />
      case 'exam':
        return <ExamScreen />
      case 'stats':
        return <StatsScreen />
      default:
        return (
          <HomeScreen
            onOpenScript={(id) => setRoute({ name: 'script', id })}
            onStartReview={() => setRoute({ name: 'review' })}
          />
        )
    }
  })()

  return (
    <div className={activeTab ? 'with-tabs' : ''}>
      {screen}
      {activeTab && (
        <nav className="tab-bar">
          {TABS.map(({ tab, icon, label }) => (
            <button
              key={tab}
              className={`tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setRoute({ name: tab } as Route)}
            >
              <span className="tab-icon">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
