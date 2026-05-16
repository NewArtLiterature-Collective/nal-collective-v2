import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom'; 
import { supabase } from './supabaseClient';
import { usePayment } from './hooks/usePayment';
import { useEvaluation } from './hooks/useEvaluation';
import logo from './assets/nal_logo.png';

export default function Dashboard({ session }) {
  const navigate = useNavigate();

  // --- 1. 核心状态管理 ---
  const [activeTab, setActiveTab] = useState('text'); 
  const [workText, setWorkText] = useState('');
  const [selectedImages, setSelectedImages] = useState([]);
  const [selectedDocx, setSelectedDocx] = useState(null); 
  // 🚨 核心新增：全局赛事开关。true 为有赛事，false 为无赛事
  // 后续管理员可以在 Supabase 新建一个 site_settings 表，通过一条数据实时控制这个 client 端状态
  const [isContestActive, setIsContestActive] = useState(true);

  // 参赛作品专属状态
  const [contestText, setContestText] = useState('');
  const [contestImages, setContestImages] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // 评审进度相关
  const [userSubmissions, setUserSubmissions] = useState([]); 
  const [isRefreshing, setIsRefreshing] = useState(false); 

  // 专家模型与引擎配置状态
  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [imageType, setImageType] = useState('picturebook'); 

  // 🚨 核心修复：防止 undefined 穿透
  // 初始化时就为所有可能的细分字段提供默认值 0
  const initialMeta = session?.user?.user_metadata || {};
  const [rawUserMetadata, setRawUserMetadata] = useState(initialMeta);
  
  const [usage, setUsage] = useState({ 
    flash: initialMeta.flash_left !== undefined ? initialMeta.flash_left : 5, 
    pro_credits: initialMeta.pro_credits || 0
  });

  // 1. 动态判定 Pro 是否过期
  let processedRole = rawUserMetadata.role;
  let isProExpired = false;
  if (processedRole === 'pro' && rawUserMetadata.expiry_date) {
    if (new Date() > new Date(rawUserMetadata.expiry_date)) {
      processedRole = null; 
      isProExpired = true; 
    }
  }

  // 2. 赛事门票动态防线：老用户的历史 paid_contest_id 会在赛季更替时自动失效
  const isCurrentContestant = rawUserMetadata.role === 'contestant' && 
                              rawUserMetadata.paid_contest_id === currentContestId;

  const userRole = isProExpired ? 'free' : (processedRole || (isCurrentContestant ? 'contestant' : 'free'));
  const isPro = userRole === 'pro';
  const isContestant = userRole === 'contestant';

  // 3. 额度动态洗白
  const displayUsage = {
    flash: (isProExpired && usage.flash >= 9999) ? 5 : Math.max(0, Number(usage.flash || 0)),
    pro_credits: (isProExpired && usage.pro_credits >= 9999) ? 0 : Math.max(0, Number(usage.pro_credits || 0))
  };

  // 4. 特权卡槽熔断：有高级额度才给高级卡槽，额度为 0 立刻退回基础免费卡槽，没有中间灰色地带
  const hasAddon = !isProExpired && (displayUsage.pro_credits > 0);
    
  const isEligibleForContest = isContestant || isPro;

  // 精确映射 CSV 的四阶梯资源限制
  const currentLimits = (() => {
     if (isPro) return { count: 50, bytes: 100 * 1024 * 1024, mb: 5, display: '100MB' };
     if (isContestant || hasAddon) return { count: 5, bytes: 150 * 1024, mb: 1.5, display: '150KB' };
     return { count: 2, bytes: 50 * 1024, mb: 1, display: '50KB' };
  })();

  // 这样下面的代码依然可以使用这些变量名，且它们是实时的
  const maxImageCount = currentLimits.count;
  const maxDocxSize = currentLimits.bytes;
  const maxImageSizeMB = currentLimits.mb;
  const maxDocSizeDisplay = currentLimits.display;

  const { payLoading, loadingPlan, handlePayment, setPayLoading } = usePayment();
  
  // 🚨 还原初代调用方式：将带有完整默认值的 usage 传给 useEvaluation，防止其内部读取 undefined
  const { loading, report, evaluate } = useEvaluation(userRole, usage); 

  // --- 2. 初始化与监听逻辑 ---

  const fetchUserSubmissions = useCallback(async () => {
    if (!isEligibleForContest) return;
    setIsRefreshing(true);
    const { data } = await supabase
      .from('contest_submissions')
      .select('id, status, created_at, ai_total_score, error_msg') 
      .eq('user_id', session?.user?.id)
      .order('created_at', { ascending: false });
    
    if (data) setUserSubmissions(data);
    setTimeout(() => setIsRefreshing(false), 500); 
  }, [session?.user?.id, isEligibleForContest]);

  const refreshUserMetadata = async () => {
    const { data: { session: currentSession } } = await supabase.auth.refreshSession();
    const user = currentSession?.user || session?.user;
    
    if (user) {
      let meta = user.user_metadata || {};
      
      // 新用户自愈机制
      if (meta.flash_left === undefined) {
        const { data, error } = await supabase.auth.updateUser({
          data: { flash_left: 5 } // 仅初始化基础 flash 额度，不触碰 pro
        });
        
        if (!error && data?.user) {
          meta = data.user.user_metadata;
        }
      }

      setRawUserMetadata(meta);
      // 🚨 无论数据库有没有该字段，严格填充所有细分 pro 字段为 0
     setUsage({
      flash: meta.flash_left !== undefined ? meta.flash_left : 5,
      pro_credits: meta.pro_credits || 0
    });
    }
  };

  const fetchSiteSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('site_settings')
        .select('is_contest_active')
        .single(); // 利用单例约束，直接取单行数据
        
      if (!error && data) {
        setIsContestActive(data.is_contest_active);
      }
    } catch (err) {
      console.error("⚠️ 读取全局配置失败:", err);
    }
  };
  
  useEffect(() => {
    fetchSiteSettings();
    refreshUserMetadata();
    fetchUserSubmissions(); 
    
    const submissionSubscription = supabase
      .channel('contest_changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'contest_submissions', filter: `user_id=eq.${session?.user?.id}` }, 
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
  }, [userRole, isPro, fetchUserSubmissions, session?.user?.id]);

  // --- 3. 业务处理函数 ---

  const removeContestImage = (index) => {
    setContestImages(prev => prev.filter((_, i) => i !== index));
  };

  const removeSelectedImage = (index) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };
  
  const handleImageChange = useCallback((e) => {
    const files = Array.from(e.target.files);
    const currentMaxCount = isPro ? 50 : (isContestant || hasAddon ? 5 : 2);
    const currentMaxSizeMB = isPro ? 5 : (isContestant || hasAddon ? 1.5 : 1);

    // 🚨 修正：将新选择的图片追加到现有列表，而不是直接覆盖
    setSelectedImages(prev => {
      const newList = [...prev, ...files];
      if (newList.length > currentMaxCount) {
        alert(`数量超限！当前账户最多允许上传 ${currentMaxCount} 张图片。`);
        return prev; // 保持原样
      }
      
      const oversizedFiles = files.filter(f => f.size > currentMaxSizeMB * 1024 * 1024);
      if (oversizedFiles.length > 0) {
        alert(`文件过大！当前账户单张图片大小限制为 ${currentMaxSizeMB}MB。`);
        return prev;
      }
      return newList;
    });
  }, [maxImageCount, maxImageSizeMB]);
  
  const handleDocxChange = useCallback((e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      
      if (file.size > maxDocxSize) {
        return alert(`文件过大！您当前身份最大可上传 ${maxDocSizeDisplay} 的文档。`);
      }
      setSelectedDocx(file);
    }
  }, [maxDocxSize, maxDocSizeDisplay]); // 👈 关键：限额更新时刷新此函数
  
  const handleContestImageUpload = (e) => {
    const files = Array.from(e.target.files);
    const oversizedFiles = files.filter(f => f.size > maxImageSizeMB * 1024 * 1024);
    if (oversizedFiles.length > 0) {
      return alert(`文件过大！单张插画不得超过 ${maxImageSizeMB}MB。`);
    }
    setContestImages(prev => [...prev, ...files].slice(0, 2));
  };

  const triggerEvaluation = async () => {
    const success = await evaluate({
      activeTab, workText, selectedImages, selectedDocx, imageType, selectedModelId
    });
    
    setTimeout(refreshUserMetadata, 1500);

    if (success) {
      setWorkText(''); 
      // 🚨 评审成功后，自动清空已加载的文件和图片
      setSelectedImages([]);
      setSelectedDocx(null);
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

  const renderStatusBadge = (status) => {
    const badges = {
      pending: { label: '⏳ 待校验', color: '#94a3b8' },
      processing: { label: '🧠 评审中', color: '#4f46e5' },
      success: { label: '✅ 已入选', color: '#10b981' },
      selected: { label: '🎉 已入选', color: '#10b981' }, 
      rejected: { label: '🥀 遗憾落选', color: '#64748b' }, 
      invalid: { label: '❌ 未通过', color: '#ef4444' }
    };
    const b = badges[status] || { label: status, color: '#374151' };
    return <span style={{ backgroundColor: b.color, color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>{b.label}</span>;
  };

  const alreadySubmitted = userSubmissions.some(s => s.status !== 'invalid');
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
          <div style={styles.sidebarHeader} onClick={() => window.location.reload()}>
            {/* 确保你顶部 import logo from './assets/nal_logo.png' 引入的名字叫 logo */}
            <img src={logo} alt="NAL Logo" style={styles.sidebarLogoImg} />
            <h2 style={styles.logo}>NAL Collective</h2>
          </div>
          <nav style={styles.nav}>
            <button onClick={() => setActiveTab('guide')} style={activeTab === 'guide' ? styles.navActive : styles.navBtn}>💡 创作指导</button>
            <button onClick={() => setActiveTab('text')} style={activeTab === 'text' ? styles.navActive : styles.navBtn}>📝 文字评审</button>
            <button onClick={() => setActiveTab('picturebook')} style={activeTab === 'picturebook' ? styles.navActive : styles.navBtn}>🎨 绘本插画</button>
            <button onClick={() => navigate('/gallery')} style={{...styles.navBtn, border: '1px solid #4b5563', marginTop: '10px', color: '#fff'}}>🏛️ 访问文学展厅</button>
            {/* 🚨 修正：必须同时满足【全局有赛事】且【用户有资格】时，才对外展示大奖赛提交入口 */}
            {(isContestActive && isEligibleForContest) && (
              <button onClick={() => setActiveTab('contest')} style={activeTab === 'contest' ? { ...styles.navActive, backgroundColor: '#4f46e5' } : { ...styles.navBtn, color: '#818cf8', marginTop: '10px' }}>🏆 提交参赛作品</button>
            )}
          </nav>
        </div>
<div style={{ marginTop: 'auto' }}>
          {/* 动态卡片：有赛事显示大赛，无赛事退化为常规资源中心 */}
          <div style={styles.upgradeBox}>
            {/* 🚨 修正：根据赛事状态动态切换标题 */}
            <h4 style={styles.upgradeTitle}>{isContestActive ? "NAL“童心”征文大赛" : "NAL 专属资源中心"}</h4>
            
            {/* 🚨 核心修正：只有全局有赛事时，才渲染大赛报名按钮或资格提示。无赛事时完全不显示 */}
            {isContestActive && (
              (isContestant || isPro) ? (
                <div style={{ color: '#10b981', fontSize: '12px', marginBottom: '10px', textAlign: 'center', fontWeight: 'bold' }}>
                  ✅ 已获参赛资格
                </div>
              ) : (
                <button onClick={() => handlePayment('contestant')} style={styles.payBtn}>🚀 立即报名</button>
              )
            )}
            
            {/* 只有非 Pro 用户在资源耗尽时，才需要加油包（日常/大赛均通用） */}
            {(!isPro && usage.flash <= 0 && usage.pro_credits <= 0) && (
              <button onClick={() => handlePayment('addon')} style={styles.addonBtn}>🔋 购买资源加油包</button>
            )}
            
            {/* 已经是 Pro 的用户，不再显示升级按钮（日常/大赛均通用） */}
            {!isPro && (
              <button onClick={() => handlePayment('pro')} style={styles.proBtn}>✨ 升级专业会员</button>
            )}
          </div>
                    
          {/* 用户账号信息与安全退出区 */}
          <div style={styles.userSection}>
            <div style={styles.roleLabel}>{session.user.email}</div>
            <button onClick={() => supabase.auth.signOut()} style={styles.logoutBtn}>退出登录</button>
          </div>
        </div>
      </aside>

      <main style={styles.main}>
        
        {/* 全局常驻顶部导航栏 */}
        <div style={styles.header}>
          <h2 style={{ margin: 0, fontSize: '20px', color: '#111827', fontWeight: 'bold' }}>
            {activeTab === 'contest' && '🏆 参赛作品提交'}
            {activeTab === 'guide' && '💡 创作指导'}
            {activeTab === 'text' && '📝 文字评审'}
            {activeTab === 'picturebook' && '🎨 绘本插画'}
          </h2>

          <div style={styles.statusRow}>
             <div style={styles.statusItem}>
               <span style={styles.statusLabel}>当前引擎</span>
               <span style={styles.statusValue}>{engineName}</span>
             </div>

             {/* 阶梯资源动态显示 */}
             {isPro ? (
               <div style={styles.statusItem}>
                 <span style={styles.statusLabel}>Pro 额度</span>
                 <span style={styles.statusValue}>无限</span>
               </div>
             ) : (isContestant || hasAddon) ? (
               <>
                 <div style={styles.statusItem}>
                   <span style={styles.statusLabel}>Flash 剩余</span>
                   <span style={styles.statusValue}>{displayUsage.flash}</span>
                 </div>
                <div style={styles.statusItem}>
                   <span style={styles.statusLabel}>Pro 额度剩余</span>
                   <span style={styles.statusValue}>{displayUsage.pro_credits}</span>
                 </div>
               </>
             ) : (
               <div style={styles.statusItem}>
                 <span style={styles.statusLabel}>Flash 剩余</span>
                 <span style={styles.statusValue}>{displayUsage.flash}</span>
               </div>
             )}
          </div>
        </div>

        <div style={styles.content}>
          {activeTab === 'contest' ? (
            <div style={{ display: 'flex', flexDirection: 'row', gap: '2%', alignItems: 'flex-start' }}>
              
              <div style={{...styles.reportBox, width: '68%', boxSizing: 'border-box', padding: '30px', margin: 0 }}>
                
                <div style={{ marginTop: '0px' }}>
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

                <div style={{ marginTop: '20px' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '10px' }}>
                    作品插画 (需 1-2 幅，单张限制 <strong>{maxImageSizeMB}MB</strong>)
                  </label>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {contestImages.map((file, index) => (
                      <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 15px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                        <span style={{ fontSize: '13px', color: '#166534', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                          🖼️ {file.name} ({(file.size / 1024 / 1024).toFixed(1)}MB)
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
                        <input type="file" id="c-img" hidden multiple accept="image/*" onChange={handleContestImageUpload} />
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
            
            // 非参赛模块界面 
            <div style={{ ...styles.reportBox, margin: 0 }}>
              
              <div style={{ display: 'flex', gap: '20px', marginBottom: '25px', backgroundColor: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                
                {activeTab !== 'picturebook' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#475569' }}>💡 选择专家模型</label>
                    <select 
                      value={selectedModelId} 
                      onChange={(e) => setSelectedModelId(e.target.value)}
                      style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: 'white', color: '#1e293b', outline: 'none', cursor: 'pointer' }}
                    >
                      {models.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {activeTab === 'picturebook' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#475569' }}>🎨 选择插画类型</label>
                    <select 
                      value={imageType} 
                      onChange={(e) => setImageType(e.target.value)}
                      style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: 'white', color: '#1e293b', outline: 'none', cursor: 'pointer' }}
                    >
                      <option value="picturebook">绘本分镜分析</option>
                      <option value="illustration">单幅插画审美</option>
                    </select>
                  </div>
                )}
              </div>

              {activeTab === 'guide' && (
                <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: '1.5' }}>
                  请在下方输入您的故事灵感、大纲结构或角色设定，NAL AI 专家将为您提供深度的创作指导和理论支持。
                </p>
              )}
              {activeTab === 'text' && (
                <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: '1.5' }}>
                  支持直接粘贴正文，或上传 Word 评审文档。限制：每次限上传 <strong>1</strong> 份 .docx 文件，文件大小不超过 <strong style={{color: '#4f46e5'}}>{maxDocSizeDisplay}</strong>。
                </p>
              )}
              {activeTab === 'picturebook' && (
                <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: '1.5' }}>
                  请上传绘本插画素材。根据您的账户权限，当前最多允许批量上传 <strong style={{color: '#4f46e5'}}>{maxImageCount}</strong> 张图片，单张大小不超过 <strong style={{color: '#4f46e5'}}>{maxImageSizeMB}MB</strong> (格式：JPG / PNG)。
                </p>
              )}

              {activeTab === 'picturebook' && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '15px' }}>
                    {selectedImages.map((file, index) => (
                      <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 15px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                        <span style={{ fontSize: '13px', color: '#166534', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                          🖼️ {file.name} ({(file.size / 1024 / 1024).toFixed(1)}MB)
                        </span>
                        <button 
                          onClick={() => removeSelectedImage(index)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                        >
                          移除
                        </button>
                      </div>
                    ))}
                  </div>
                  
                  {selectedImages.length < maxImageCount && (
                    <div style={styles.uploadArea}>
                      <input type="file" id="up" hidden multiple onChange={handleImageChange} accept="image/*" />
                      <label htmlFor="up" style={styles.uploadBtn}>
                        ➕ 点击上传插画素材 (还可传 {maxImageCount - selectedImages.length} 张)
                      </label>
                    </div>
                  )}
                </div>
              )}
              
              {activeTab === 'text' && (
                <div style={{ ...styles.uploadArea, marginBottom: '20px' }}>
                  <input type="file" id="docx-up" hidden accept=".docx" onChange={handleDocxChange} />
                  <label htmlFor="docx-up" style={styles.uploadBtn}>
                    {selectedDocx ? `✅ 已选择: ${selectedDocx.name}` : "📄 上传 Word 评审文档 (.docx)"}
                  </label>
                </div>
              )}
              
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '8px' }}>
                {activeTab === 'picturebook' ? '补充说明 / 画面描述 (可选)' : '正文内容'}
              </label>
              <textarea 
                style={{ ...styles.textarea, width: '100%', boxSizing: 'border-box' }} 
                placeholder={activeTab === 'picturebook' ? "可在此添加针对画面的理论阐述或细节描述..." : "在此粘贴需要评审的文本..."} 
                value={workText} 
                onChange={(e) => setWorkText(e.target.value)} 
              />
              
              <button 
                onClick={triggerEvaluation} 
                disabled={loading} 
                style={{ ...styles.submitBtn, width: '100%', marginTop: '20px' }}
              >
                {loading ? "AI 专家计算中..." : (activeTab === 'guide' ? "启动创作指导" : "启动评审分析")}
              </button>
            </div>
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
  main: { flex: 1, padding: '30px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' },

  logoContainer: {display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '24px 16px', borderBottom: '1px solid rgba(0, 0, 0, 0.05)'},
  logoImage: {width: '140px', height: 'auto', objectFit: 'contain'}
  
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white', padding: '20px 30px', borderRadius: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  statusRow: { display: 'flex', gap: '30px', alignItems: 'center' },
  statusItem: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }, 
  
  statusLabel: { fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase' },
  statusValue: { fontSize: '15px', fontWeight: 'bold', color: '#111827' },
  statusEmpty: { fontSize: '15px', fontWeight: 'bold', color: '#ef4444' },
  content: { display: 'flex', flexDirection: 'column', gap: '15px' },
  textarea: { height: '320px', padding: '20px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', lineHeight: '1.7', outline: 'none' },
  uploadArea: { padding: '25px', border: '2px dashed #d1d5db', borderRadius: '12px', textAlign: 'center', backgroundColor: '#f8fafc' },
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
