import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/AuthContext'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter basename="/bliss-app">
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
)
