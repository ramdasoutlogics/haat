import { Link } from 'react-router-dom'
import { Empty } from '../components/ui'

export function title(_: never) {
  return 'Page not found'
}

export default function NotFound() {
  return (
    <div className="wrap" style={{ padding: '48px 18px', flex: 1 }}>
      <Empty icon="search" title="We couldn't find that page">
        <span>It may have been moved, or the listing was removed.</span>
        <Link to="/" className="btn primary" style={{ marginTop: 8 }}>Go to home</Link>
      </Empty>
    </div>
  )
}
