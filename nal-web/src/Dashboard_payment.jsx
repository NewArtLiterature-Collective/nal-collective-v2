import React, { useState, useEffect } from 'react';
// 🚨 修正路径：确保指向 src 下的客户端文件
import { supabase } from './supabaseClient'; 

const Dashboard = () => {
  // --- 1. 核心状态管理 ---
  const [user, setUser] = useState(null);
  const [metadata, setMetadata] = useState({});
  const [loading, setLoading] = useState(false);
  const [payLoading, setPayLoading] = useState(false); // 独立支付加载状态
  
  // 评审任务相关的输入状态
  const [taskType, setTaskType] = useState('illustration');
  const [workText, setWorkText] = useState('');
  const [imageUrls, setImageUrls] = useState(['']); // 默认支持多图输入
  const [report, setReport] = useState("");

  // --- 2. 初始化与自动同步逻辑 ---
  useEffect(() => {
    fetchUserAndStatus();

    // 🏆 上午复盘的“无感同步”核心：监测支付回调
    const params = new URLSearchParams(window.location.search);
    if (params.get('session_id')) {
      console.log("🎊 支付成功回调，正在同步云端权限...");
      // 清理 URL 并强制刷新页面，触发 App.jsx 重新拉取已付费状态
      window.history.replaceState({}, document.title, window.location.pathname);
      window.location.reload(); 
    }
  }, []);

  const fetchUserAndStatus = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(session.user);
      setMetadata(session.user.user_metadata || {});
    }
  };

  // --- 3. 支付跳转逻辑 (对接 payment_service.py) ---
  const handlePayment = async (planType) => {
    setPayLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_BASE_URL;
      const { data: { session: authSession } } = await supabase.auth.getSession();
      
      if (!authSession?.user) return alert("请先登录");

      // 指向专门的支付路由，避免干扰评审逻辑
      const response = await fetch(`${apiUrl}/api/v1/payment/create-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authSession.access_token}`
        },
        body: JSON.stringify({
          user_id: authSession.user.id,
          user_email: authSession.user.email,
          plan: planType 
        })
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url; // 物理跳转至 Stripe
      }
    } catch (err) {
      alert("支付网关连接失败: " + err.message);
    } finally {
      setPayLoading(false);
    }
  };

  // --- 4. 绘本插画评审逻辑 (对接 evaluation.py) ---
  const handleEvaluate = async () => {
    // 权限与额度预检
    const flashLeft = metadata.flash_left ?? 4;
    if (!metadata.is_paid && flashLeft <= 0) {
      return alert("您的免费额度已耗尽，请报名参赛以解锁更多次数。");
    }

    if (taskType === 'illustration' && imageUrls.filter(u => u).length === 0) {
      return alert("请至少输入一张插画的 URL。");
    }

    setLoading(true);
    setReport(""); // 清空旧报告

    try {
      const apiUrl = import.meta.env.VITE_API_BASE_URL;
      const { data: { session: authSession } } = await supabase.auth.getSession();

      const response = await fetch(`${apiUrl}/api/v1/evaluate/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authSession.access_token}`
        },
        body: JSON.stringify({
          task_type: taskType,
          image_urls: imageUrls.filter(u => u),
          work_text: workText,
          image_type: taskType === 'illustration' ? 'illustration' : 'storyboard'
        })
      });

      const data = await response.json();
      if (data.report) {
        setReport(data.report);
        // 评审成功后刷新本地元数据（更新剩余次数）
        fetchUserAndStatus();
      } else {
        throw new Error(data.detail || "分析引擎未返回有效报告");
      }
    } catch (err) {
      alert("评审失败: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- 5. UI 辅助函数 ---
  const updateImageUrl = (index, value) => {
    const newUrls = [...imageUrls];
    newUrls[index] = value;
    setImageUrls(newUrls);
  };

  const addImageUrlField = () => setImageUrls([...imageUrls, '']);

  // --- 6. 样式配置 ---
  const styles = {
    container: { display: 'flex', minHeight: '100vh', backgroundColor: '#f9fafb', color: '#111827' },
    sidebar: { width: '300px', backgroundColor: '#fff', borderRight: '1px solid #e5e7eb', padding: '24px' },
    main: { flex: 1, padding: '40px', maxWidth: '900px', margin: '0 auto' },
    card: { backgroundColor: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '24px' },
    label: { display: 'block', fontWeight: '600', marginBottom: '8px', fontSize: '14px' },
    input: { width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db', marginBottom: '16px' },
    textarea: { width: '100%', minHeight: '120px', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db', marginBottom: '16px', fontFamily: 'inherit' },
    primaryBtn: { width: '100%', padding: '12px', backgroundColor: '#4f46e5', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' },
    secondaryBtn: { width: '100%', padding: '12px', backgroundColor: '#fff', color: '#4f46e5', border: '1px solid #4f46e5', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' },
    badge: { display: 'inline-block', padding: '4px 12px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', marginBottom: '12px' }
  };

  return (
    <div style={styles.container}>
      {/* 侧边栏：状态展示与支付入口 */}
      <aside style={styles.sidebar}>
        <h2 style={{fontSize: '20px', marginBottom: '24px'}}>NAL 控制台</h2>
        <div style={{marginBottom: '32px'}}>
          <p style={{fontSize: '14px', color: '#6b7280'}}>当前账号</p>
          <p style={{fontWeight: '600', wordBreak: 'break-all'}}>{user?.email}</p>
        </div>

        <div style={{marginBottom: '32px'}}>
          {metadata.is_paid && <span style={styles.badge}>🏆 2026 届参赛选手</span>}
          <p style={{fontSize: '14px'}}>剩余 Flash 评审次数：<strong>{metadata.flash_left ?? 4}</strong></p>
        </div>

        {!metadata.is_paid && (
          <div style={{backgroundColor: '#eef2ff', padding: '20px', borderRadius: '12px'}}>
            <h4 style={{margin: '0 0 8px 0', color: '#3730a3'}}>解锁专家级视角</h4>
            <p style={{fontSize: '12px', color: '#4338ca', marginBottom: '16px'}}>报名参赛即可获得 10 次 Gemini 2.0 Pro 深度协同分析额度。</p>
            <button onClick={() => handlePayment('contestant')} disabled={payLoading} style={styles.primaryBtn}>
              {payLoading ? "正在连接 Stripe..." : "🚀 立即报名 (CAD $10)"}
            </button>
          </div>
        )}
      </aside>

      {/* 主界面：调优后的评审表单 */}
      <main style={styles.main}>
        <header style={{marginBottom: '32px'}}>
          <h1 style={{fontSize: '28px', fontWeight: '800'}}>作品 AI 评审</h1>
          <p style={{color: '#6b7280'}}>提交您的插画或绘本草图，获取 NAL 专家模型的深度反馈。</p>
        </header>

        <section style={styles.card}>
          <label style={styles.label}>任务类型</label>
          <select 
            value={taskType} 
            onChange={(e) => setTaskType(e.target.value)}
            style={styles.input}
          >
            <option value="illustration">单幅插画评审 (Visual Identity)</option>
            <option value="storyboard">连环分镜/绘本草图评审</option>
          </select>

          <label style={styles.label}>插画素材 URL (可添加多张)</label>
          {imageUrls.map((url, index) => (
            <input 
              key={index}
              type="text" 
              placeholder="https://..." 
              value={url} 
              onChange={(e) => updateImageUrl(index, e.target.value)}
              style={styles.input}
            />
          ))}
          <button 
            onClick={addImageUrlField}
            style={{fontSize: '13px', color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', marginBottom: '16px'}}
          >
            + 添加更多图片链接
          </button>

          <label style={styles.label}>作品/剧本描述</label>
          <textarea 
            placeholder="请输入作品的背景故事、创作动机或文字脚本..." 
            value={workText}
            onChange={(e) => setWorkText(e.target.value)}
            style={styles.textarea}
          />

          <button 
            onClick={handleEvaluate} 
            disabled={loading} 
            style={{...styles.primaryBtn, backgroundColor: loading ? '#9ca3af' : '#111827'}}
          >
            {loading ? "AI 正在分析作品细节，请稍候..." : "开始 AI 视觉协同评审"}
          </button>
        </section>

        {/* 评审结果展示区 */}
        {report && (
          <section style={{...styles.card, borderLeft: '4px solid #4f46e5'}}>
            <h3 style={{marginTop: 0}}>NAL 专家评审报告</h3>
            <div style={{whiteSpace: 'pre-wrap', lineHeight: '1.6', color: '#374151', fontSize: '15px'}}>
              {report}
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default Dashboard;