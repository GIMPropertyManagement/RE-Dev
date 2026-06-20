import { Link } from 'react-router-dom';
import { previewMode } from '../lib/api';

export function Topbar({ signOut, email }: { signOut?: () => void; email?: string }) {
  return (
    <header className="topbar">
      <Link to="/" className="brand brand-link">
        Forge Hill <span className="brand-sub">Land Analyzer</span>
      </Link>
      <div className="topbar-right">
        {previewMode && <span className="pill pill-warn">preview · sample data</span>}
        {email && <span className="user">{email}</span>}
        {signOut && (
          <button className="btn-ghost" onClick={signOut}>
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
