import { Link } from 'react-router-dom';
import { Button } from '../components/ui';
import { Logo } from '../components/Logo';

export function NotFoundPage() {
  return (
    <div className="page">
      <nav className="topnav">
        <div className="container topnav-inner">
          <Logo />
        </div>
      </nav>
      <div className="fullscreen-state">
        <h1>Page not found</h1>
        <p className="muted">That link does not exist — maybe the game moved on without it.</p>
        <Link to="/">
          <Button variant="primary">Back to the start</Button>
        </Link>
      </div>
    </div>
  );
}
