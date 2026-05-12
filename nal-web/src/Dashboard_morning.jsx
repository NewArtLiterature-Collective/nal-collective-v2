import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function Dashboard({ session }) {
  const [workText, setWorkText] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);

  // --- 新增：支付成功回跳检测 ---
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('session_id')) {
      console.log("检测到支付成功回跳，正在同步用户状态...");
      
      // 1. 清理 URL 中的参数，保持地址栏美观
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // 2. 强制刷新页面。这会触发 Supabase 重新获取 Session，
      // 从而拿到 Webhook 更新后的 user_metadata.is_paid
      window.location.reload();
    }
  }, []);

  // --- 支付跳转逻辑 ---
const handlePayment = async (e) => {
  if (e) e.preventDefault();
  try {
    const apiUrl = import.meta.env.VITE_API_BASE_URL;
    // 🚨 关键：获取真实的当前用户信息
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const currentUser = authSession?.user;

    if (!currentUser) return alert("请先登录");

    const response = await fetch(`${apiUrl}/api/v1/payment/create-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authSession.access_token}`
      },
      // 🚨 将真实的 id 和 email 发给后端
      body: JSON.stringify({
        user_id: currentUser.id,
        user_email: currentUser.email
      })
    });
      
      const data = await response.json();
      
      // 兼容处理：无论后端返回的是对象还是纯字符串 URL
      const targetUrl = data.url || data;

      if (targetUrl && typeof targetUrl === 'string') {
        window.location.href = targetUrl;
      } else {
        alert("未能获取支付链接，请稍后再试。");
      }
    } catch (error) {
      console.error("支付请求失败:", error);
      alert("支付系统繁忙，请重试。");
    }
  };

  // --- 退出登录 ---
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // --- AI 评审逻辑 ---
  const handleEvaluate = async (e) => {
    if (e) e.preventDefault();
    if (!workText) return alert("请输入作品内容！");
    
    setLoading(true);
    setReport(null);

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const apiUrl = import.meta.env.VITE_API_BASE_URL;
      
      const response = await fetch(`${apiUrl}/api/v1/evaluate/pro`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authSession.access_token}`
        },
        body: JSON.stringify({
          work_title: "网页端提交",
          work_text: workText,
          mentor_type: "全景综合-通用基准模型"
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "评审请求失败");

      setReport(data.report || data.message || JSON.stringify(data));
    } catch (error) {
      alert(`❌ 评审失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '40px auto', fontFamily: 'sans-serif', padding: '0 20px' }}>
      {/* 顶部状态栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h2>NAL 创作者工作台</h2>
        <div>
          <span style={{ marginRight: '15px', fontSize: '14px' }}>{session.user.email}</span>
          <button onClick={handleLogout} style={{ cursor: 'pointer' }}>退出</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <textarea 
          placeholder="在此输入您的儿童文学作品..." 
          value={workText}
          onChange={(e) => setWorkText(e.target.value)}
          rows="12"
          style={{ width: '100%', padding: '15px', borderRadius: '8px', border: '1px solid #ddd' }}
        />
        
        {/* 只有未支付用户才显示报名横幅 */}
        {!session.user.user_metadata?.is_paid && (
          <div style={{ 
            background: 'linear-gradient(135deg, #6e8efb, #a777e3)', 
            color: 'white', 
            padding: '20px', 
            borderRadius: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <h4 style={{ margin: 0 }}>🏆 2026 届儿童文学专项赛通道</h4>
              <p style={{ margin: '5px 0 0', fontSize: '14px', opacity: 0.9 }}>支付注册费后即可解锁深度 AI 评审</p>
            </div>
            <button 
              onClick={handlePayment}
              style={{ 
                padding: '8px 16px', 
                backgroundColor: 'white', 
                color: '#6e8efb', 
                border: 'none', 
                borderRadius: '20px', 
                fontWeight: 'bold', 
                cursor: 'pointer' 
              }}>
              立即报名
            </button>
          </div>
        )}

        <button 
          onClick={handleEvaluate} 
          disabled={loading}
          style={{ 
            padding: '15px', 
            backgroundColor: '#000', 
            color: '#fff', 
            border: 'none', 
            borderRadius: '8px', 
            cursor: 'pointer', 
            fontWeight: 'bold' 
          }}
        >
          {loading ? '🧠 正在深度分析中...' : '启动智能评审'}
        </button>
      </div>

      {report && (
        <div style={{ marginTop: '40px', padding: '25px', backgroundColor: '#fdfdfd', borderRadius: '10px', border: '1px solid #eee' }}>
          <h3 style={{ marginTop: 0 }}>⚖️ 评审报告</h3>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8', color: '#333' }}>
            {report}
          </div>
        </div>
      )}
    </div>
  );
}