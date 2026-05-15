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
  const [isRefreshing, setIsRefreshing] = useState(false); 

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

  const removeContestImage = (index) => {
    setContestImages(prev => prev.filter((_, i) => i !== index));
  };

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
    
    const hasExisting = userSubmissions.some(s => s.status !== 'invalid');
    if (hasExisting) return alert("您已经提交过参赛作品，每个账户限投一次。");

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

  // 🚨 补充了 rejected 和 selected 的标签样式设计
  const renderStatusBadge = (status) => {
    const badges = {
      pending: { label: '⏳ 待校验', color: '#94a3b8' },
      processing: { label: '🧠 评审中', color: '#4f46e5' },
      success: { label: '✅ 已入选', color: '#10b981' },
      selected: { label: '🎉 已入选', color: '#10b981' }, // 兼容新的状态词
      rejected: { label: '🥀 遗憾落选', color: '#64748b' }, // 截图中的灰色状态词
      invalid: { label: '❌ 未通过', color: '#ef4444' }
    };
    const b = badges[status] || { label: status, color: '#374151' };
    return <span style={{ backgroundColor: b.color, color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>{b.label}</span>;
  };

  const alreadySubmitted = userSubmissions.some(s => s.status !== 'invalid');

  return (
    <div style={styles.dashboard}>
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
        <div style={styles.content}>
          {activeTab === 'contest' ? (
            // 🚨 核心排版调整：利用百分比绝对锁定左右宽度比例
            <div style={{ display: 'flex', flexDirection: 'row', gap: '2%', alignItems: 'flex-start' }}>
              
              {/* 左侧：表单 (严格锁定为 68% 的宽度) */}
              <div style={{...styles.reportBox, width: '68%', boxSizing: 'border-box', padding: '30px', margin: 0 }}>
                <h3 style={{ marginTop: 0, color: '#111827', borderBottom: '2px solid #f3f4f6', paddingBottom: '15px' }}>🌟 参赛作品提交</h3>
                
                {/* 文本输入框 */}
                <div style={{ marginTop: '20px' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '8px' }}>作品正文 (最大 800 字)</label>
                  <textarea 
                    style={{
                      ...styles.textarea, 
                      height: '380px', 
                      width: '100%', 
                      boxSizing: 'border-box',
                      backgroundColor: '#f9fafb',
                      resize: 'none'
                    }}
                    placeholder="在此粘贴您的参赛作品文字内容..."
                    value={contestText}
                    onChange={(e) => {
                      if (e.target.value.length <= 800) setContestText(e.target.value);
                    }}
                  />
                  <div style={{ textAlign: 'right', fontSize: '12px', color: contestText.length >= 800 ? '#ef4444' : '#94a3b8', marginTop: '5px' }}>
                    {contestText.length} / 800 字
                  </div>
                </div>

                {/* 插画上传 */}
                <div style={{ marginTop: '20px' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '10px' }}>作品插画 (需 1-2 幅)</label>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {contestImages.map((file, index) => (
                      <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 15px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                        <span style={{ fontSize: '13px', color: '#166534', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                          🖼️ {file.name}
                        </span>
                        <button 
                          onClick={() => removeContestImage(index)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                        >
                          移除
                        </button>
                      </div>
                    ))}
                    
                    {contestImages.length < 2 && (
                      <div style={{...styles.uploadArea, padding: '15px'}}>
                        <input type="file" id="c-img" hidden multiple accept="image/*" 
                          onChange={(e) => {
                            const newFiles = Array.from(e.target.files);
                            setContestImages(prev => [...prev, ...newFiles].slice(0, 2));
                          }} 
                        />
                        <label htmlFor="c-img" style={{...styles.uploadBtn, fontSize: '13px'}}>
                          {contestImages.length === 0 ? "➕ 上传第一幅插画" : "➕ 上传第二幅插画"}
                        </label>
                      </div>
                    )}
                  </div>
                </div>

                <button 
                  onClick={submitContestWork} 
                  disabled={isSubmitting || alreadySubmitted} 
                  style={{
                    ...styles.submitBtn, 
                    width: '100%', 
                    marginTop: '30px', 
                    backgroundColor: alreadySubmitted ? '#94a3b8' : '#4f46e5',
                    cursor: alreadySubmitted ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isSubmitting ? "正在上传..." : (alreadySubmitted ? "🔒 您已提交作品" : "📤 确认提交参赛作品")}
                </button>
                {alreadySubmitted && <p style={{fontSize: '11px', color: '#94a3b8', textAlign: 'center', marginTop: '10px'}}>注：目前每位参赛选手限提交一次作品。</p>}
              </div>

              {/* 🚨 右侧：进度列表 (严格锁定为 30% 的宽度，并且缩小了内部 padding 防止撑开) */}
              <div style={{...styles.reportBox, width: '30%', boxSizing: 'border-box', padding: '20px', margin: 0, backgroundColor: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <h4 style={{ margin: 0, color: '#334155', fontSize: '14px' }}>📊 评审实时进度</h4>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981', animation: 'pulse 2s infinite' }}></div>
                </div>

                {userSubmissions.length === 0 ? (
                  <p style={{fontSize: '12px', color: '#94a3b8', textAlign: 'center', padding: '20px 0'}}>暂无记录</p>
                ) : (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                    {userSubmissions.map(sub => (
                      <div key={sub.id} style={{padding: '12px', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                          <span style={{fontSize: '11px', color: '#94a3b8'}}>{new Date(sub.created_at).toLocaleDateString()}</span>
                          {renderStatusBadge(sub.status)}
                        </div>
                        <div style={{fontSize: '11px', fontWeight: 'bold', color: '#1e293b', fontFamily: 'monospace'}}>ID: {sub.id.substring(0,8)}</div>
                        
                        {(sub.status === 'success' || sub.status === 'selected') && sub.ai_total_score > 0 && (
                          <div style={{fontSize: '12px', color: '#10b981', marginTop: '6px', fontWeight: 'bold'}}>评分: {sub.ai_total_score.toFixed(1)}</div>
                        )}
                        {/* 如果是落选（rejected），也把分数展示出来让用户心服口服 */}
                        {sub.status === 'rejected' && sub.ai_total_score > 0 && (
                          <div style={{fontSize: '12px', color: '#64748b', marginTop: '6px', fontWeight: 'bold'}}>评分: {sub.ai_total_score.toFixed(1)}</div>
                        )}
                        {sub.status === 'invalid' && sub.error_msg && (
                          <div style={{fontSize: '10px', color: '#ef4444', marginTop: '6px', lineHeight: '1.4'}}>⚠️ {sub.error_msg}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                
                <button 
                  onClick={fetchUserSubmissions} 
                  disabled={isRefreshing}
                  style={{marginTop: '15px', width: '100%', padding: '8px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', color: '#64748b'}}
                >
                  {isRefreshing ? "同步中..." : "🔄 刷新状态"}
                </button>
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
  sidebar: { width: '240px', backgroundColor: '#111827', color: 'white', padding: '30px 20px', display: 'flex', flexDirection: 'column' },
  logo: { fontSize: '20px', fontWeight: 'bold', color: '#a78bfa', marginBottom: '40px' },
  nav: { flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' },
  navBtn: { padding: '12px', textAlign: 'left', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', borderRadius: '8px' },
  navActive: { padding: '12px', textAlign: 'left', background: '#374151', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '8px', fontWeight: 'bold' },
  userSection: { borderTop: '1px solid #374151', paddingTop: '20px' },
  roleLabel: { fontSize: '12px', color: '#9ca3af', textAlign: 'center', marginBottom: '18px', wordBreak: 'break-all', padding: '4px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '4px' },
  logoutBtn: { width: '100%', background: '#374151', border: 'none', color: '#f3f4f6', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
  main: { flex: 1, padding: '40px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' },
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
  proBtn: { width: '100%', backgroundColor: 'transparent', color: '#a78bfa', border: '1px solid #a78bfa', padding: '8px', borderRadius: '8px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' },
};
