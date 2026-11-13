import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { supabase, IS_RECOVERY_LINK, IS_AUTH_LINK_ERROR } from './supabaseClient'

import Home from './Home'
import Auth from './Auth'
import Dashboard from './Dashboard'
import Gallery from './Gallery'
import ResetPassword from './ResetPassword'
import EmailConfirm from './EmailConfirm'
import { PricingPage, TermsPage, RefundPage, PrivacyPage, ContestRulesPage, ContactPage } from './LegalPages'

// 🚨 导入后台专用的组件
// 注意：如果你将这两个文件放在了 components 或 pages 文件夹下，请对应修改这里的路径（例如 './components/AdminGuard'）
import AdminGuard from './components/AdminGuard' 
import AdminDashboard from './AdminDashboard'

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
  // 注册刚完成时（nal_registered 标记存在），即便注册瞬间产生了临时会话，也不自动跳转到工作区，
  // 让 Auth 停在"注册成功"页；用户点"前往登录"清除标记后，正常登录才会进工作区。
  let justRegistered = false;
  try { justRegistered = !!sessionStorage.getItem('nal_registered'); } catch {}
  if (session && !justRegistered) {
    return <Navigate to={`/dashboard${location.search}`} replace />;
  }
  return <Auth />;
}

// 🔑 重置密码链接兜底：若 Supabase 因白名单不符把链接退回到首页等其他地址，
//    这里仍把用户送到"设置新密码"页，而不是带着临时会话直接进工作台。
function RecoveryRedirect() {
  const location = useLocation();
  if (IS_RECOVERY_LINK && location.pathname !== '/reset-password') {
    return <Navigate to="/reset-password" replace />;
  }
  // 邮件链接已失效（如注册确认链接过期）被带回首页等处 → 转到确认页，说明原因并可重新发送
  if (IS_AUTH_LINK_ERROR && !IS_RECOVERY_LINK && !['/reset-password', '/auth/confirm'].includes(location.pathname)) {
    return <Navigate to="/auth/confirm" replace />;
  }
  return null;
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
      <RecoveryRedirect />
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
        
        {/* 🔑 设置新密码（忘记密码邮件的回跳页，公开访问） */}
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* 📧 注册邮箱确认 / 重新发送确认邮件（公开访问） */}
        <Route path="/auth/confirm" element={<EmailConfirm />} />

        {/* 📜 合规页面（公开访问，支付宝 / 微信支付 / Stripe 审核需要） */}
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/refund" element={<RefundPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/contest-rules" element={<ContestRulesPage />} />
        <Route path="/contact" element={<ContactPage />} />

        {/* 兜底：访问不存在的路径一律退回首页 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
