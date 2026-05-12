import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function Dashboard({ session }) {
  // --- 1. 核心状态 ---
  const [activeTab, setActiveTab] = useState('text'); 
  const [workText, setWorkText] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [selectedImages, setSelectedImages] = useState([]);

  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [imageType, setImageType] = useState('illustration'); 

  // 用户权限状态管理
  const [userMetadata, setUserMetadata] = useState(session.user.user_metadata || {});
  const userRole = userMetadata.role || (userMetadata.is_paid ? 'contestant' : 'free');
  const isPro = userRole === 'pro';
  const isContestant = userRole === 'contestant';
  
  // 额度状态
  const [usage, setUsage] = useState({
    flash: 0,
    guide_pro: 0,
    text_pro: 0,
    illustration_pro: 0
  });

  // --- 2. 🚨 核心修复：刷新用户元数据与次数 ---
  const refreshUserMetadata = async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!error && user) {
      const meta = user.user_metadata || {};
      setUserMetadata(meta);
      setUsage({
        flash: meta.flash_left !== undefined ? meta.flash_left : 4,
        guide_pro: meta.guide_pro || 0,
        text_pro: meta.text_pro || 0,
        illustration_pro: meta.illustration_pro || 0
      });
    }
  };

  // 初始化加载
  useEffect(() => {
    refreshUserMetadata(); // 初始获取
    const fetchModels = async () => {
      const { data, error } = await supabase.from('evaluation_models').select('id, name');
      if (!error && data) {
        let filtered = isPro ? data : data.filter(m => m.name.includes('全景综合') || m.name.includes('首席专家'));
        setModels(filtered);
        if (filtered.length > 0) setSelectedModelId(filtered[0].id);
      }
    };
    fetchModels();
  }, [userRole, isPro]);

  // --- 3. 功能函数 ---
  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    const max = isPro ? 50 : 5;
    if (files.length > max) return alert(`最多上传 ${max} 张`);
    setSelectedImages(files);
  };

  const uploadImagesToStorage = async (files) => {
    const urls = [];
    for (let file of files) {
      const filePath = `user_uploads/${session.user.id}/${Date.now()}_${file.name}`;
      await supabase.storage.from('nal_images').upload(filePath, file);
      const { data } = supabase.storage.from('nal_images').getPublicUrl(filePath);
      urls.push(data.publicUrl);
    }
    return urls;
  };

  const getEngineInfo = () => {
    if (isPro) return { name: 'Gemini 1.5 Pro', tag: '专业版' };
    const proLeft = usage[`${activeTab}_pro`];
    if (proLeft > 0) return { name: 'Gemini 2.0 Pro', tag: '参赛特供' };
    return { name: 'Gemini 2.0 Flash', tag: '基础版' };
  };
  const engine = getEngineInfo();

  // --- 4. 提交评审逻辑 ---
  const handleEvaluate = async () => {
    if (activeTab !== 'illustration' && !workText) return alert("请输入内容");
    if (activeTab === 'illustration' && selectedImages.length === 0) return alert("请上传图片");

    setLoading(true);
    setReport(null);

    try {
      let publicImageUrls = [];
      if (activeTab === 'illustration') {
        publicImageUrls = await uploadImagesToStorage(selectedImages);
      }

      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/evaluate/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSession?.access_token}`
        },
        body: JSON.stringify({
          task_type: activeTab,
          work_text: workText,
          user_role: userRole,
          image_type: activeTab === 'illustration' ? imageType : null,
          image_urls: publicImageUrls,
          model_db_id: activeTab === 'illustration' ? null : selectedModelId
        })
      });

      const resData = await response.json();
      if (!response.ok) throw new Error(resData.detail || "请求失败");
      
      setReport(resData.report);
      
      // 🚨 核心修复：评审成功后，等待 1.5 秒（给后端扣费逻辑一点时间）然后刷新次数
      setTimeout(() => {
        refreshUserMetadata();
      }, 1500);

    } catch (error) {
      alert(`分析中断: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.dashboard}>
      {/* 侧边栏 */}
      <aside style={styles.sidebar}>
        <div>
          <h2 style={styles.logo}>NAL Collective</h2>
          <nav style={styles.nav}>
            <button onClick={() => setActiveTab('guide')} style={activeTab === 'guide' ? styles.navActive : styles.navBtn}>💡 创作指导</button>
            <button onClick={() => setActiveTab('text')} style={activeTab === 'text' ? styles.navActive : styles.navBtn}>📝 文字评审</button>
            <button onClick={() => setActiveTab('illustration')} style={activeTab === 'illustration' ? styles.navActive : styles.navBtn}>🎨 绘本插画</button>
          </nav>
        </div>
        
        {/* 底部用户信息与报名区，使用 marginTop: 'auto' 把它推到最下面 */}
        <div style={{ marginTop: 'auto' }}>
          
          {/* 🚨 动态报名/升级提示框 (仅对非 Pro 且非参赛选手显示) */}
          {!isPro && !isContestant && (
            <div style={styles.upgradeBox}>
              <h4 style={styles.upgradeTitle}>2026 NAL 评审季</h4>
              <p style={styles.upgradeDesc}>解锁 Gemini 2.0 Pro 高级视角的深度协同分析报告。</p>
              <button 
                onClick={() => alert("这里即将接入 Stripe / 微信支付跳转...")} 
                style={styles.payBtn}
              >
                🚀 立即报名 (¥10)
              </button>
              <button 
                onClick={() => alert("年费专业版订阅...")} 
                style={styles.proBtn}
              >
                升级专业会员 (¥300/年)
              </button>
            </div>
          )}

          <div style={styles.userSection}>
            <div style={isContestant ? styles.contestBadge : styles.freeBadge}>
               {isContestant ? "🏆 已报名 · 2026 评审季" : "☕ 普通用户 · 未参赛"}
            </div>
            <div style={styles.roleLabel}>{isPro ? "✨ 尊贵的专业会员" : `登录账号: ${session.user.email}`}</div>
            <button onClick={() => supabase.auth.signOut()} style={styles.logoutBtn}>退出登录</button>
          </div>
        </div>
      </aside>

      {/* 主界面 */}
      <main style={styles.main}>
        <div style={styles.header}>
          <div style={styles.selectorGroup}>
            {activeTab === 'illustration' ? (
              <>
                <label style={styles.label}>评审模式：</label>
                <select value={imageType} onChange={(e) => setImageType(e.target.value)} style={styles.select}>
                  <option value="picture-book">📘 绘本分镜分析</option>
                  <option value="illustration">🖼️ 单幅插画审美</option>
                </select>
              </>
            ) : (
              <>
                <label style={styles.label}>评审专家：</label>
                <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)} style={styles.select}>
                  {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </>
            )}
          </div>

          <div style={styles.statusRow}>
             <div style={styles.statusItem}>
                <span style={styles.statusLabel}>引擎</span>
                <span style={styles.statusValue}>{engine.name}</span>
             </div>
             
             {/* 🚨 修复 1：次数实时显示 */}
             {!isPro && (
               <div style={styles.statusItem}>
                  <span style={styles.statusLabel}>Flash 剩余</span>
                  <span style={usage.flash > 0 ? styles.statusValue : styles.statusEmpty}>{usage.flash}</span>
               </div>
             )}

             {isContestant && usage[`${activeTab}_pro`] > 0 && (
               <div style={styles.statusItem}>
                  <span style={styles.statusLabel}>Pro 奖励额度</span>
                  <span style={{...styles.statusValue, color: '#8b5cf6'}}>{usage[`${activeTab}_pro`]}</span>
               </div>
             )}
          </div>
        </div>

        <div style={styles.content}>
          {activeTab === 'illustration' && (
            <div style={styles.uploadArea}>
              <input type="file" id="up" hidden multiple onChange={handleImageChange} accept="image/*" />
              <label htmlFor="up" style={styles.uploadBtn}>
                {selectedImages.length > 0 ? `✅ 已加载 ${selectedImages.length} 张图` : "➕ 点击批量上传评审素材"}
              </label>
            </div>
          )}
          
          <textarea 
            style={styles.textarea}
            placeholder={activeTab === 'illustration' ? "请输入分镜文案或创作意图..." : "在此输入作品内容..."}
            value={workText}
            onChange={(e) => setWorkText(e.target.value)}
          />

          <button onClick={handleEvaluate} disabled={loading} style={styles.submitBtn}>
            {loading ? "AI 深度计算中..." : "启动评审"}
          </button>
        </div>

        {report && (
          <div style={styles.reportBox}>
            <h3 style={{marginTop: 0, fontSize: '18px', borderBottom: '1px solid #eee', paddingBottom: '10px'}}>🏛️ NAL 专家评审报告</h3>
            <div style={styles.reportTxt}>{report}</div>
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  dashboard: { display: 'flex', height: '100vh', backgroundColor: '#f3f4f6', fontFamily: 'system-ui' },
  sidebar: { width: '240px', backgroundColor: '#111827', color: 'white', padding: '30px 20px', display: 'flex', flexDirection: 'column' },
  logo: { fontSize: '20px', fontWeight: 'bold', color: '#a78bfa', marginBottom: '40px' },
  nav: { flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' },
  navBtn: { padding: '12px', textAlign: 'left', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', borderRadius: '8px' },
  navActive: { padding: '12px', textAlign: 'left', background: '#374151', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '8px', fontWeight: 'bold' },
  
  userSection: { borderTop: '1px solid #374151', paddingTop: '20px' },
  contestBadge: { backgroundColor: '#1e3a8a', color: '#60a5fa', fontSize: '12px', padding: '8px', borderRadius: '6px', textAlign: 'center', marginBottom: '8px', fontWeight: 'bold', border: '1px solid #2563eb' },
  freeBadge: { backgroundColor: '#374151', color: '#9ca3af', fontSize: '12px', padding: '8px', borderRadius: '6px', textAlign: 'center', marginBottom: '8px' },
  roleLabel: { fontSize: '11px', color: '#6b7280', textAlign: 'center', marginBottom: '15px' },
  logoutBtn: { width: '100%', background: 'none', border: '1px solid #4b5563', color: '#9ca3af', padding: '8px', borderRadius: '6px', cursor: 'pointer' },

  main: { flex: 1, padding: '40px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white', padding: '15px 30px', borderRadius: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  selectorGroup: { display: 'flex', alignItems: 'center', gap: '10px' },
  select: { padding: '8px', borderRadius: '6px', border: '1px solid #d1d5db', outline: 'none' },
  label: { fontSize: '14px', color: '#6b7280' },
  
  statusRow: { display: 'flex', gap: '30px' },
  statusItem: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  statusLabel: { fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase' },
  statusValue: { fontSize: '14px', fontWeight: 'bold', color: '#111827' },
  statusEmpty: { fontSize: '14px', fontWeight: 'bold', color: '#ef4444' },

  content: { display: 'flex', flexDirection: 'column', gap: '15px' },
  textarea: { height: '320px', padding: '20px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', lineHeight: '1.7', outline: 'none' },
  uploadArea: { padding: '25px', border: '2px dashed #d1d5db', borderRadius: '12px', textAlign: 'center', backgroundColor: 'white' },
  uploadBtn: { cursor: 'pointer', color: '#6366f1', fontWeight: 'bold' },
  submitBtn: { padding: '16px', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer' },
  
  reportBox: { padding: '40px', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', textAlign: 'left' },
  reportTxt: { whiteSpace: 'pre-wrap', lineHeight: '2.0', color: '#374151', fontSize: '16px' },
  // 报名/升级模块样式
  upgradeBox: { ackgroundColor: '#1f2937', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #374151' },
  upgradeTitle: { color: '#f9fafb', fontSize: '14px', fontWeight: 'bold', marginTop: '0', marginBottom: '6px' },
  upgradeDesc: { color: '#9ca3af', fontSize: '12px', lineHeight: '1.5', marginBottom: '15px', marginTop: '0'  },
  payBtn: { width: '100%', backgroundColor: '#6366f1', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '8px', transition: 'background 0.2s' },
  proBtn: { width: '100%', backgroundColor: 'transparent', color: '#a78bfa', border: '1px solid #a78bfa',  padding: '8px', borderRadius: '8px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' },
};