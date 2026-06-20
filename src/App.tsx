import { Route, Routes } from 'react-router-dom';
import { Authenticator } from '@aws-amplify/ui-react';
import { amplifyConfigured } from './amplifyConfig';
import { Topbar } from './components/Topbar';
import Dashboard from './pages/Dashboard';
import Detail from './pages/Detail';
import './App.css';

function Shell({ signOut, email }: { signOut?: () => void; email?: string }) {
  return (
    <div className="app">
      <Topbar signOut={signOut} email={email} />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/parcels/:id" element={<Detail />} />
      </Routes>
    </div>
  );
}

export default function App() {
  // No backend provisioned yet -> preview mode, no auth wall.
  if (!amplifyConfigured) return <Shell />;
  return (
    <Authenticator hideSignUp>
      {({ signOut, user }) => (
        <Shell
          signOut={signOut}
          email={(user as { signInDetails?: { loginId?: string } })?.signInDetails?.loginId}
        />
      )}
    </Authenticator>
  );
}
