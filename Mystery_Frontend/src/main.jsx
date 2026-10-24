import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider } from './context/AuthContext'
import App from './App.jsx'
import './index.css'

if (import.meta.env.DEV) {
  console.info(
    '%c[Spot]%c dev server · if Scenarios still looks old, confirm this URL is Vite (e.g. localhost:3000) and hard-refresh',
    'font-weight:bold;color:#0284c7',
    'color:#64748b'
  )
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={googleClientId}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </GoogleOAuthProvider>
  </React.StrictMode>,
)
