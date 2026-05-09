// React 훅 — features 적재 race 방지용.
// 컴포넌트 안에서 한 줄 호출하면 setFeatures가 호출될 때마다 자동 리렌더 → hasFeature가 새 값 반환.
import { useEffect, useState } from 'react'
import { subscribeFeatures } from './features'

export function useFeaturesVersion() {
  const [, set] = useState(0)
  useEffect(() => subscribeFeatures(() => set(v => v + 1)), [])
}
