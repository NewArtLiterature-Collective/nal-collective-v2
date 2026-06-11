import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { supabase } from './supabaseClient'

import Home from './Home'
import Auth from './Auth'
import Dashboard from './Dashboard'
import Gallery from './Gallery'

// 🚨 导入后台专用的组件
// 注意：如果你将这两个文件放在了 components 或 pages 文件夹下，请对应修改这里的路径（例如 './components/AdminGuard'）
import AdminGuard from './components/AdminGuard' 
import AdminDashboard from './pages/AdminDashboard'

// 🚨 参赛者路由守卫：确保未登录用户无法进入 Dashboard
function ProtectedRoute({ session, children }) {
  const location = useLocation();
  if (!session) {
    return <Navigate to={`/login${location.search}`} replace />;
  }
  return children;
}

// 🚨 参赛者登录页逻辑包装
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
        
        {/* 2. 公共展厅（传递 session 用于判断前台导航栏的登录状态） */}
        <Route path="/gallery" element={<Gallery session={session} />} />
        
        {/* 3. 前台认证页 (参赛者专属) */}
        <Route 
          path="/login" 
          element={<LoginWrapper session={session} />} 
        />
        
        {/* 4. 受保护的选手工作台 */}
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute session={session}>
              <Dashboard session={session} />
            </ProtectedRoute>
          } 
        />

        {/* 🚨 5. NAL 中央管理台 (完全独立的管理员路由与守卫) */}
        {/* 这里不需要传入普通的 session，AdminGuard 内部会自行接管高权限身份的校验 */}
        <Route 
          path="/admin" 
          element={
            <AdminGuard>
              <AdminDashboard />
            </AdminGuard>
          } 
        />
        
        {/* 兜底：访问不存在的路径一律退回首页 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
