import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { supabase } from './supabaseClient'

import Home from './Home'
import Auth from './Auth'
import Dashboard from './Dashboard'
import Gallery from './Gallery' // ✅ 1. 导入展厅组件

// 🚨 路由守卫：确保未登录用户无法进入 Dashboard
function ProtectedRoute({ session, children }) {
  const location = useLocation();
  if (!session) {
    return <Navigate to={`/login${location.search}`} replace />;
  }
  return children;
}

// 🚨 登录页逻辑包装
function LoginWrapper({ session }) {
  const location = useLocation();
  if (session) {
    return <Navigate to={`/dashboard${location.search}`} replace />;
  }
  return <Auth />;
}

function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const initializeAuth = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      setSession(currentSession)
      setLoading(false)
    }

    initializeAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) return null

  return (
    <BrowserRouter>
      <Routes>
        {/* 1. 公共主页 */}
        <Route path="/" element={<Home />} />
        
        {/* ✅ 2. 公共展厅（传递 session 用于判断导航状态） */}
        <Route path="/gallery" element={<Gallery session={session} />} />
        
        {/* 3. 认证页 */}
        <Route 
          path="/login" 
          element={<LoginWrapper session={session} />} 
        />
        
        {/* 4. 受保护的工作台 */}
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute session={session}>
              <Dashboard session={session} />
            </ProtectedRoute>
          } 
        />
        
        {/* 兜底 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
