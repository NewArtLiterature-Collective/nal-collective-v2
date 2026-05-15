import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom'; 
import { supabase } from './supabaseClient';
import { usePayment } from './hooks/usePayment';
import { useEvaluation } from './hooks/useEvaluation';

export default function Dashboard({ session }) {
  const navigate = useNavigate();

  // --- 1. 核心状态管理 ---
  const [activeTab, setActiveTab] = useState('text'); 
  const [workText, setWorkText] = useState('');
  const [selectedImages, setSelectedImages] = useState([]);
  const [selectedDocx, setSelectedDocx] = useState(null); 

  // 参赛作品专属状态
  const [contestText, setContestText] = useState('');
  const [contestImages, setContestImages] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // 评审进度相关
  const [userSubmissions, setUserSubmissions] = useState([]); 
  const [isRefreshing, setIsRefreshing] = useState(false); // 🚨 新增：刷新状态动画

  // 专家模型与引擎配置
  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [imageType, setImageType] = useState('illustration'); 

  // 用户身份与权限逻辑
  const [rawUserMetadata, setRawUserMetadata] = useState(session.user.user_metadata || {});
  
  let userMetadata = { ...rawUserMetadata };
  if (userMetadata.role === 'pro' && userMetadata.expiry_date) {
    const now = new Date();
    const expiry = new Date(userMetadata.expiry_date);
    if (now > expiry) {
      userMetadata.role = null; 
      userMetadata.is_paid = false;
    }
  }

  const userRole = userMetadata.role || (userMetadata.is_paid ? 'contestant' : 'free');
  const isPro = userRole === 'pro';
  const isContestant = userRole === 'contestant';
  const isEligibleForContest = isContestant || isPro;

  const [usage, setUsage] = useState({ flash: 0, pro_credits: 0 });

  const { payLoading, loadingPlan, handlePayment, setPayLoading } = usePayment();
  const { loading, report, evaluate } = useEvaluation(userRole, usage);

  // --- 2. 初始化与监听逻辑 ---

  const fetchUserSubmissions = useCallback(async () => {
    if (!isEligibleForContest) return;
    setIsRefreshing(true);
    const { data } = await supabase
      .from('contest_submissions')
      .select('id, status, created_at, ai_total_score, error_msg') 
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    
    if (data) setUserSubmissions(data);
    setTimeout(() => setIsRefreshing(false), 500); 
  }, [session.user.id, isEligibleForContest]);

  const refreshUserMetadata = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const meta = user.user_metadata || {};
      setRawUserMetadata(meta);
      setUsage({
        flash: meta.flash_left !== undefined ? meta.flash_left : 5,
        pro_credits: meta.pro_credits || 0 
      });
    }
  };

  useEffect(() => {
    refreshUserMetadata();
    fetchUserSubmissions(); 
    
    const submissionSubscription = supabase
      .channel('contest_changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'contest_submissions', filter: `user_id=eq.${session.user.id}` }, 
        () => fetchUserSubmissions()
      )
      .subscribe();

    const params = new URLSearchParams(window.location.search);
    const intent = params.get('intent');
    if (intent === 'pro' && !isPro) {
      handlePayment('pro');
    } else if (intent === 'contestant' && !isContestant && !isPro) {
      handlePayment('contestant');
    }

    const fetchModels = async () => {
      const { data } = await supabase.from('evaluation_models').select('id, name');
      if (data) {
        let filtered = isPro ? data : data.filter(m => m.name.includes('全景综合') || m.name.includes('首席专家'));
        setModels(filtered);
        const defaultModel = filtered.find(m => m.name.includes('首席专家'));
        if (defaultModel) setSelectedModelId(defaultModel.id);
        else if (filtered.length > 0) setSelectedModelId(filtered[0].id);
      }
    };
    fetchModels();

    return () => {
      supabase.removeChannel(submissionSubscription); 
    };
  }, [userRole, isPro, fetchUserSubmissions, session.user.id]);

  // --- 3. 业务处理函数 ---

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    const max = isPro ? 50 : (isContestant ? 5 : 2);
    if (files.length > max) return alert(`数量超限！最多上传 ${max} 张图片。`);
    setSelectedImages(files);
  };

  const handleDocxChange = (e) => {
    if (e.target.files.length > 0) setSelectedDocx(e.target.files[0]); 
  };

  const triggerEvaluation = async () => {
    const success = await evaluate({
      activeTab, workText, selectedImages, selectedDocx, imageType, selectedModelId
    });
    if (success) {
      setWorkText(''); 
      setTimeout(refreshUserMetadata, 1500); 
    }
  };

  const submitContestWork = async () => {
    if (contestImages.length < 1 || contestImages.length > 2) return alert("请上传 1-2 幅插画！");
    if (contestText.trim().length < 500) return alert("参赛文字内容需接近 800 字。");

    setIsSubmitting(true);
    try {
      const imageUrls = [];
      for (const file of contestImages) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${session.user.id}_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('contest_works').upload(fileName, file);
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('contest_works').getPublicUrl(fileName);
        imageUrls.push(data.publicUrl);
      }

      const { error: dbError } = await supabase.from('contest_submissions').insert({
        user_id: session.user.id,
        user_email: session.user.email,
        text_content: contestText,
        image_urls: imageUrls,
        status: 'pending'
      });
      if (dbError) throw dbError;

      alert("🎉 提交成功！评审已自动启动，请在右侧追踪实时进度。");
      setContestText('');
      setContestImages([]);
      fetchUserSubmissions(); 
    } catch (error) {
      alert("❌ 失败: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStatusBadge = (status) => {
    const badges = {
      pending: { label: '⏳ 待校验', color: '#6b7280' },
      processing: { label: '🧠 评审中', color: '#4f46e5' },
      success: { label: '✅ 已入选', color: '#10b981' },
      invalid: { label: '❌ 未通过', color: '#ef4444' }
    };
    const b = badges[status] || { label: status, color: '#374151' };
    return <span style={{ backgroundColor: b.color, color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '10px' }}>{b.label}</span>;
  };

  const engineName = isPro ? "文学专业旗舰版" : (isContestant ? "高级文学引擎" : "基础版");

  return (
    <div style={styles.dashboard}>
      {payLoading && (
        <div style={styles.overlay}>
          <div style={styles.paymentModal}>
            <div style={styles.spinner}></div>
            <h3 style={{ margin: '20px 0 10px 0', color: '#111827' }}>正在连接支付网关...</h3>
            <button onClick={() => setPayLoading(false)} style={styles.cancelPayBtn}>返回</button>
          </div>
        </div>
      )}

      <aside style={styles.sidebar}>
        <div>
          <h2 style={styles.logo}>NAL Collective</h2>
          <nav style={styles.nav}>
            <button onClick={() => setActiveTab('guide')} style={activeTab === 'guide' ? styles.navActive : styles.navBtn}>💡 创作指导</button>
            <button onClick={() => setActiveTab('text')} style={activeTab === 'text' ? styles.navActive : styles.navBtn}>📝 文字评审</button>
            <button onClick={() => setActiveTab('illustration')} style={activeTab === 'illustration' ? styles.navActive : styles.navBtn}>🎨 绘本插画</button>
            <button onClick={() => navigate('/gallery')} style={{...styles.navBtn, border: '1px solid #4b5563', marginTop: '10px', color: '#fff'}}>🏛️ 访问文学展厅</button>
            {isEligibleForContest && (
              <button onClick={() => setActiveTab('contest')} style={activeTab === 'contest' ? {...styles.navActive, backgroundColor: '#4f46e5'} : {...styles.navBtn, color: '#818cf8', marginTop: '10px'}}>🏆 提交参赛作品</button>
            )}
          </nav>
        </div>
        <div style={{ marginTop: 'auto' }}>
          {!isPro && (
            <div style={styles.upgradeBox}>
              <h4 style={styles.upgradeTitle}>NAL“童心”征文大赛</h4>
              {!isContestant ? (
                <button onClick={() => handlePayment('contestant')} style={styles.payBtn}>🚀 立即报名</button>
              ) : (
                <div style={{color: '#10b981', fontSize: '12px', marginBottom: '10px', textAlign: 'center', fontWeight: 'bold'}}>✅ 已获参赛资格</div>
              )}
              <button onClick={() => handlePayment('pro')} style={styles.proBtn}>✨ 升级专业会员</button>
            </div>
          )}
          <div style={styles.userSection}>
            <div style={styles.roleLabel}>{session.user.email}</div>
            <button onClick={() => supabase.auth.signOut()} style={styles.logoutBtn}>退出登录</button>
          </div>
        </div>
      </aside>

      <main style={styles.main}>
        {activeTab !== 'contest' && (
          <div style={styles.header}>
            <div style={styles.statusRow}>
               <div style={styles.statusItem}><span style={styles.statusLabel}>引擎</span><span style={styles.statusValue}>{engineName}</span></div>
               {!isPro && <div style={styles.statusItem}><span style={styles.statusLabel}>Flash 剩余</span><span style={styles.statusValue}>{usage.flash}</span></div>}
            </div>
          </div>
        )}

        <div style={styles.content}>
          {activeTab === 'contest' ? (
            <div style={{ display: 'flex', flexDirection: 'row', gap: '25px', alignItems: 'flex-start' }}>
              
              {/* 🚨 左侧：表单 (放大了比例 flex: 2.5) */}
              <div style={{...styles.reportBox, flex: 2.5, margin: 0 }}>
                <h3 style={{ marginTop: 0, color: '#111827', borderBottom: '2px solid #f3f4f6', paddingBottom: '15px' }}>🌟 参赛作品提交</h3>
                
                {/* 🚨 优化后的文本输入框：横置、字数限制 */}
                <div style={{ marginTop: '20px' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '8px' }}>作品正文 (限 800 字)</label>
                  <textarea 
                    style={{
                      ...styles.textarea, 
                      height: '350px', 
                      width: '100%', 
                      boxSizing: 'border-box',
                      backgroundColor: '#f9fafb',
                      resize: 'vertical'
                    }}
                    placeholder="在此粘贴参赛作品文字..."
                    value={contestText}
                    onChange={(e) => {
                      if (e.target.value.length <= 800) {
                        setContestText(e.target.value);
                      }
                    }}
                  />
                  <div style={{ textAlign: 'right', fontSize: '13px', color: contestText.length >= 800 ? '#ef4444' : '#6b7280', marginTop: '6px', fontWeight: '500' }}>
                    {contestText.length} / 800 字
                  </div>
                </div>

                {/* 🚨 优化后的插画上传：显示文件名，支持删除更换 */}
                <div style={{ marginTop: '20px' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '8px' }}>相关插画 (1-2幅)</label>
                  
                  {contestImages.length > 0 ? (
                    <div style={{ padding: '16px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                        {contestImages.map((file, idx) => (
                          <div key={idx} style={{ fontSize: '14px', color: '#166534', display: 'flex', alignItems: 'center' }}>
                            <span style={{ marginRight: '8px' }}>🖼️</span>
                            {file.name}
                          </div>
                        ))}
                      </div>
                      <button 
                        onClick={() => setContestImages([])} 
                        style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', padding: 0 }}
                      >
                        🗑️ 删除并重新选择
                      </button>
                    </div>
                  ) : (
                    <div style={styles.uploadArea}>
                      <input type="file" id="c-img" hidden multiple accept="image/*" onChange={(e) => setContestImages(Array.from(e.target.files).slice(0,2))} />
                      <label htmlFor="c-img" style={{...styles.uploadBtn, display: 'block'}}>
                        ➕ 点击上传插画文件
                      </label>
                    </div>
                  )}
                </div>

                <button onClick={submitContestWork} disabled={isSubmitting} style={{...styles.submitBtn, width: '100%', marginTop: '30px', backgroundColor: '#4f46e5'}}>
                  {isSubmitting ? "作品上传中..." : "📤 确认提交参赛作品"}
                </button>
              </div>

              {/* 右侧：进度列表 (保持原功能，缩小比例 flex: 1) */}
              <div style={{...styles.reportBox, flex: 1, margin: 0, backgroundColor: '#f8fafc', minWidth: '300px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <h4 style={{ margin: 0, color: '#334155' }}>📊 评审实时进度</h4>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981', animation: 'pulse 2s infinite' }}></div>
                </div>

                {userSubmissions.length === 0 ? (
                  <p style={{fontSize: '13px', color: '#94a3b8', textAlign: 'center', padding: '20px 0'}}>暂无提交记录</p>
                ) : (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
                    {userSubmissions.map(sub => (
                      <div key={sub.id} style={{padding: '12px', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                          <span style={{fontSize: '11px', color: '#64748b'}}>{new Date(sub.created_at).toLocaleDateString()}</span>
                          {renderStatusBadge(sub.status)}
                        </div>
                        <div style={{fontSize: '12px', fontWeight: 'bold', color: '#1e293b', fontFamily: 'monospace'}}>ID: {sub.id.substring(0,8)}...</div>
                        
                        {sub.status === 'success' && sub.ai_total_score > 0 && (
                          <div style={{fontSize: '13px', color: '#10b981', marginTop: '6px', fontWeight: 'bold'}}>综合评分: {sub.ai_total_score.toFixed(1)}</div>
                        )}
                        {sub.status === 'invalid' && sub.error_msg && (
                          <div style={{fontSize: '11px', color: '#ef4444', marginTop: '6px', lineHeight: '1.4'}}>⚠️ {sub.error_msg}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                
                <button 
                  onClick={fetchUserSubmissions} 
                  disabled={isRefreshing}
                  style={{marginTop: '20px', width: '100%', padding: '8px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#64748b'}}
                >
                  {isRefreshing ? "正在同步..." : "🔄 刷新列表"}
                </button>
                <p style={{ fontSize: '10px', color: '#94a3b8', marginTop: '10px', textAlign: 'center' }}>
                  Agent 自动评审中，状态将实时更新
                </p>
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'illustration' && (
                <div style={styles.uploadArea}>
                  <input type="file" id="up" hidden multiple onChange={handleImageChange} accept="image/*" />
                  <label htmlFor="up" style={styles.uploadBtn}>{selectedImages.length > 0 ? `✅ 已加载 ${selectedImages.length} 张图` : "➕ 点击批量上传评审素材"}</label>
                </div>
              )}
              {activeTab === 'text' && (
                <div style={styles.uploadArea}>
                  <input type="file" id="docx-up" hidden accept=".docx" onChange={handleDocxChange} />
                  <label htmlFor="docx-up" style={styles.uploadBtn}>{selectedDocx ? `✅ 已选择: ${selectedDocx.name}` : "📄 上传 Word 评审文档 (.docx)"}</label>
                </div>
              )}
              <textarea style={styles.textarea} placeholder="粘贴文本或备注..." value={workText} onChange={(e) => setWorkText(e.target.value)} />
              <button onClick={triggerEvaluation} disabled={loading} style={styles.submitBtn}>{loading ? "AI 计算中..." : "启动评审"}</button>
            </>
          )}
        </div>

        {report && activeTab !== 'contest' && (
          <div style={styles.reportBox}>
            <h3 style={{marginTop: 0, fontSize: '18px', borderBottom: '1px solid #eee', paddingBottom: '10px'}}>🏛️ NAL 专家分析结果</h3>
            <div style={styles.reportTxt}>{report}</div>
          </div>
        )}
      </main>
      
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  dashboard: { display: 'flex', height: '100vh', backgroundColor: '#f3f4f6', fontFamily: 'system-ui' },
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', zIndex: 1000 },
  paymentModal: { margin: 'auto', backgroundColor: 'white', padding: '40px', borderRadius: '24px', textAlign: 'center', width: '90%', maxWidth: '400px', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' },
  spinner: { width: '40px', height: '40px', border: '4px solid #f3f4f6', borderTop: '4px solid #4f46e5', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' },
  cancelPayBtn: { background: 'none', border: '1px solid #d1d5db', color: '#6b7280', padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' },
  sidebar: { width: '240px', backgroundColor: '#111827', color: 'white', padding: '30px 20px', display: 'flex', flexDirection: 'column' },
  logo: { fontSize: '20px', fontWeight: 'bold', color: '#a78bfa', marginBottom: '40px' },
  nav: { flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' },
  navBtn: { padding: '12px', textAlign: 'left', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', borderRadius: '8px' },
  navActive: { padding: '12px', textAlign: 'left', background: '#374151', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '8px', fontWeight: 'bold' },
  userSection: { borderTop: '1px solid #374151', paddingTop: '20px' },
  proBadge: { background: 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)', color: 'white', fontSize: '13px', padding: '10px', borderRadius: '8px', textAlign: 'center', marginBottom: '10px', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(139, 92, 246, 0.4)' },
  freeBadge: { backgroundColor: '#374151', color: '#e5e7eb', fontSize: '12px', padding: '8px', borderRadius: '6px', textAlign: 'center', marginBottom: '10px', fontWeight: 'bold' },
  contestBadge: { backgroundColor: '#1e3a8a', color: '#60a5fa', fontSize: '11px', padding: '8px', borderRadius: '6px', textAlign: 'center', marginBottom: '12px', fontWeight: 'bold', border: '1px solid #2563eb' },
  pendingBadge: { backgroundColor: 'rgba(255,255,255,0.05)', color: '#9ca3af', fontSize: '11px', padding: '8px', borderRadius: '6px', textAlign: 'center', marginBottom: '12px', border: '1px dashed #4b5563' },
  roleLabel: { fontSize: '12px', color: '#9ca3af', textAlign: 'center', marginBottom: '18px', wordBreak: 'break-all', padding: '4px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '4px' },
  logoutBtn: { width: '100%', background: '#374151', border: 'none', color: '#f3f4f6', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
  main: { flex: 1, padding: '40px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white', padding: '15px 30px', borderRadius: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
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
  upgradeBox: { backgroundColor: '#1f2937', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #374151' },
  upgradeTitle: { color: '#f9fafb', fontSize: '14px', fontWeight: 'bold', marginTop: '0', marginBottom: '8px' },
  payBtn: { width: '100%', backgroundColor: '#6366f1', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '8px' },
  addonBtn: { width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '8px' },
  proBtn: { width: '100%', backgroundColor: 'transparent', color: '#a78bfa', border: '1px solid #a78bfa', padding: '8px', borderRadius: '8px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' },
};
