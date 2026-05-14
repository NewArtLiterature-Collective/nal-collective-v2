import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { supabase } from './supabaseClient'

import Home from './Home'
import Auth from './Auth'
import Dashboard from './Dashboard'

// 🚨 路由守卫：确保未登录用户无法进入 Dashboard
function ProtectedRoute({ session, children }) {
  const location = useLocation();
  if (!session) {
    // 未登录时，跳转到登录页并保留当前尝试访问的路径和参数
    return <Navigate to={`/login${location.search}`} replace />;
  }
  return children;
}

// 🚨 登录页逻辑包装：确保参数能够传递给 Dashboard
function LoginWrapper({ session }) {
  const location = useLocation();
  // 如果已登录，重定向到 Dashboard，并【关键点】透传所有 URL 参数（如 ?intent=pro）
  if (session) {
    return <Navigate to={`/dashboard${location.search}`} replace />;
  }
  return <Auth />;
}

function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 初始化 Auth 状态
    const initializeAuth = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      setSession(currentSession)
      setLoading(false)
    }

    initializeAuth()

    // 监听 Auth 状态变化
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
        
        {/* 2. 认证页（使用 LoginWrapper 处理参数透传） */}
        <Route 
          path="/login" 
          element={<LoginWrapper session={session} />} 
        />
        
        {/* 3. 受保护的工作台 */}
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
